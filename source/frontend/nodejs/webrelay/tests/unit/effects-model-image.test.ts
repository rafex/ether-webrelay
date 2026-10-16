import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The effects model ships inside the image so the page needs no third-party origin (CSP) and
// does not tell Google who visits. These guard the three pieces that make that true.
const ROOT = resolve(__dirname, '../../../../../..');
const containerfile = readFileSync(resolve(ROOT, 'containers/frontend/Containerfile'), 'utf8');
const nginx = readFileSync(resolve(ROOT, 'containers/frontend/nginx.conf'), 'utf8');

describe('self-hosted effects model', () => {
  it('is downloaded at build time against a pinned SHA-256', () => {
    expect(containerfile).toMatch(/ARG EFFECTS_MODEL_SHA256=[0-9a-f]{64}\b/);
    expect(containerfile).toMatch(/sha256sum -c -/);
    expect(containerfile).toMatch(/dist\/models\/selfie_segmenter\.tflite/);
  });

  it('is what the image configures the client to load', () => {
    expect(containerfile).toMatch(
      /^ENV WEBRELAY_EFFECTS_MODEL_URL=\/models\/selfie_segmenter\.tflite$/m,
    );
  });

  it('is served by nginx from /models/ with the security headers', () => {
    const block = /location \/models\/ \{([\s\S]*?)\n {4}\}/.exec(nginx)?.[1] ?? '';
    expect(block).toContain('security-headers.conf');
    expect(block).toContain('/tmp/webrelay-csp.conf');
    expect(block).toContain('try_files $uri =404');
  });
});
