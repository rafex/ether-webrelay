import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderPugPlaceholders } from '../../build/vite-plugin-pug';

const root = fileURLToPath(new URL('../..', import.meta.url));

describe('Pug templates', () => {
  it('renders the real index page with every element the app binds to', () => {
    const entry = readFileSync(`${root}/index.html`, 'utf8');
    const html = renderPugPlaceholders(entry, root, { appVersion: '9.9.9', protocolVersion: 1 });

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).not.toContain('<pug');
    expect(html).toContain('<script type="module" src="/src/main.ts"></script>');
    expect(html).toContain('v9.9.9');
    for (const id of [
      'relay-form',
      'bridgeUrl',
      'camera',
      'microphone',
      'screen',
      'systemAudio',
      'resolution',
      'framerate',
      'start',
      'stop',
      'preview',
      'state-badge',
      'record',
      'export-ogv',
    ]) {
      expect(html, `#${id}`).toContain(`id="${id}"`);
    }
  });

  it('accepts self-closing placeholders and leaves other markup alone', () => {
    const html = renderPugPlaceholders(
      '<main><pug src="tests/fixtures/hello.pug" /></main>',
      root,
      { name: 'relay' },
    );
    expect(html).toBe('<main><p class="greeting">Hola, relay</p></main>');
  });
});
