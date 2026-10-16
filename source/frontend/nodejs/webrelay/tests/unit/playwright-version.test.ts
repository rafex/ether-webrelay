import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The E2E container ships the browsers of one exact Playwright release, and the
// `@playwright/test` package refuses to launch any other ("Looks like Playwright was just
// updated to X"). Dependabot bumps the npm package and the container image in separate
// pull requests, so each one fails alone; bump both in the same change.
const ROOT = resolve(__dirname, '../../../../../..');

describe('Playwright package and E2E container', () => {
  it('use the same Playwright version', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(ROOT, 'source/frontend/nodejs/webrelay/package.json'), 'utf8'),
    );
    const containerfile = readFileSync(resolve(ROOT, 'containers/e2e/Containerfile'), 'utf8');
    const image = /^FROM mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-/m.exec(
      containerfile,
    )?.[1];
    const npm = pkg.devDependencies?.['@playwright/test'];

    expect(
      image,
      'containers/e2e/Containerfile must FROM mcr.microsoft.com/playwright:vX.Y.Z-…',
    ).toBeDefined();
    expect(npm, '@playwright/test must be a devDependency pinned to an exact version').toMatch(
      /^\d+\.\d+\.\d+$/,
    );
    expect(
      npm,
      `@playwright/test ${npm} does not match the E2E image v${image}: bump package.json (and the lockfile) and containers/e2e/Containerfile together`,
    ).toBe(image);
  });
});
