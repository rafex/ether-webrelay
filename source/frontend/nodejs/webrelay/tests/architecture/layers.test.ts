import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Enforces the hexagonal dependency rules documented in docs/architecture.md:
 * domain ← ports ← application, infrastructure ← ui.
 */
const SRC = fileURLToPath(new URL('../../src', import.meta.url));

const FORBIDDEN: Record<string, readonly string[]> = {
  domain: ['ports', 'application', 'infrastructure', 'ui'],
  ports: ['application', 'infrastructure', 'ui'],
  application: ['infrastructure', 'ui'],
  infrastructure: ['application', 'ui'],
};

/** Browser-only globals that must not leak into the pure layers. */
const BROWSER_APIS =
  /\b(document|window|navigator|VideoEncoder|AudioEncoder|VideoFrame|AudioData|AudioContext|WebSocket|MediaStream)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function importsOf(file: string): string[] {
  const code = readFileSync(file, 'utf8');
  return [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
}

function layerOf(file: string): string {
  return relative(SRC, file).split('/')[0] ?? '';
}

describe('hexagonal layering', () => {
  for (const [layer, forbidden] of Object.entries(FORBIDDEN)) {
    it(`${layer}/ does not depend on ${forbidden.join(', ')}`, () => {
      const violations = sourceFiles(join(SRC, layer)).flatMap((file) =>
        importsOf(file)
          .filter((spec) => spec.startsWith('.'))
          .map((spec) => layerOf(join(file, '..', spec)))
          .filter((target) => forbidden.includes(target))
          .map((target) => `${relative(SRC, file)} → ${target}/`),
      );
      expect(violations).toEqual([]);
    });
  }

  it('domain/ and application/ stay free of browser APIs and npm packages', () => {
    const files = [...sourceFiles(join(SRC, 'domain')), ...sourceFiles(join(SRC, 'application'))];
    const violations = files.flatMap((file) => {
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      const external = importsOf(file).filter((spec) => !spec.startsWith('.'));
      return [
        ...external.map((spec) => `${relative(SRC, file)} imports ${spec}`),
        ...(BROWSER_APIS.test(code) ? [`${relative(SRC, file)} uses a browser API`] : []),
      ];
    });
    expect(violations).toEqual([]);
  });
});
