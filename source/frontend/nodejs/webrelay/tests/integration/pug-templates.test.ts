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
    // Each screen is present; only the loading one is visible at first.
    for (const screen of ['loading', 'invalid', 'lobby', 'call', 'left']) {
      expect(html).toContain(`data-screen="${screen}"`);
    }
    expect(html).not.toMatch(/rtmps|stream ?key|clave de stream/i);
    for (const id of [
      'join-form',
      'join-name',
      'join-title',
      'join-button',
      'lobby-preview',
      'lobby-mic',
      'lobby-cam',
      'lobby-settings',
      'lobby-effects',
      'room-title',
      'host-name',
      'channel-list',
      'call',
      'stage',
      'call-mic',
      'call-cam',
      'call-screen',
      'call-view',
      'view-menu',
      'call-record',
      'call-settings',
      'call-leave',
      'stats-panel',
      'minimal-card',
      'settings',
      'set-camera',
      'set-microphone',
      'set-speaker',
      'set-resolution',
      'set-mirror',
      'set-echo',
      'set-noise',
      'set-gain',
      'background-choices',
      'background-upload',
      'set-name',
      'set-title',
      'shortcut-list',
      'tpl-tile',
      'tpl-toast',
      'invalid-message',
      'left-message',
      'rejoin',
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
