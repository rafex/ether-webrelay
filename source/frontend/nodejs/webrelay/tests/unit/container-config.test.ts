import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// containers/frontend/40-webrelay-config.sh runs at container start and turns
// WEBRELAY_* into config.json and the Content-Security-Policy include. The
// bridge URL ends up inside a response header, so it must never be able to
// widen the policy.
const SCRIPT = resolve(__dirname, '../../../../../../containers/frontend/40-webrelay-config.sh');

function run(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'webrelay-'));
  writeFileSync(join(dir, 'config.json'), '{"bundled":true}\n');
  const csp = join(dir, 'csp.conf');
  const result = spawnSync('sh', [SCRIPT], {
    env: { PATH: '/usr/bin:/bin', WEBRELAY_HTML_DIR: dir, WEBRELAY_CSP_FILE: csp, ...env },
    encoding: 'utf8',
  });
  const read = (file: string) => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
  };
  const policy = read(csp);
  return {
    status: result.status,
    stderr: result.stderr,
    config: read(join(dir, 'config.json')),
    policy,
    connectSrc: policy?.match(/connect-src ([^;]*);/)?.[1],
  };
}

describe('frontend container entrypoint', () => {
  it('keeps the bundled config and a development CSP without a configured bridge', () => {
    const r = run({});
    expect(r.status).toBe(0);
    expect(r.config).toBe('{"bundled":true}\n');
    expect(r.connectSrc).toContain('wss:');
    expect(r.connectSrc).toContain('ws://localhost:*');
  });

  it('narrows connect-src to the configured bridge instead of any wss:', () => {
    const r = run({ WEBRELAY_BRIDGE_URL: 'wss://streaming.rafex.app/signal' });
    expect(r.status).toBe(0);
    expect(r.connectSrc).toBe(
      "'self' wss://streaming.rafex.app https://storage.googleapis.com blob:",
    );
    expect(r.connectSrc).not.toMatch(/\bwss:(?!\/)/);
    expect(r.connectSrc).not.toContain('localhost');
    expect(JSON.parse(r.config ?? '{}')).toMatchObject({
      bridgeUrl: 'wss://streaming.rafex.app/signal',
      transport: 'webrtc',
    });
  });

  it('keeps ports, a separate relay and a self-hosted model out of third-party hosts', () => {
    const r = run({
      WEBRELAY_BRIDGE_URL: 'wss://bridge.example:8443/signal',
      WEBRELAY_RELAY_URL: 'wss://relay.example/ws',
      WEBRELAY_EFFECTS_MODEL_URL: '/models/selfie.tflite',
    });
    expect(r.status).toBe(0);
    expect(r.connectSrc).toBe("'self' wss://bridge.example:8443 wss://relay.example blob:");
  });

  it('ships the rest of the policy unchanged', () => {
    const { policy } = run({ WEBRELAY_BRIDGE_URL: 'wss://b.example/s' });
    for (const directive of [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ]) {
      expect(policy).toContain(directive);
    }
  });

  it.each([
    ['a header-splitting host', 'wss://a.example";script-src *;/x'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a plain http: URL', 'http://a.example/s'],
    ['an empty host', 'wss:///signal'],
    ['a space in the host', 'wss://a.example evil.example/s'],
  ])('refuses to start with %s', (_label, url) => {
    const r = run({ WEBRELAY_BRIDGE_URL: url });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('WEBRELAY_BRIDGE_URL');
    expect(r.config).toBe('{"bundled":true}\n');
    expect(r.policy).toBeUndefined();
  });
});
