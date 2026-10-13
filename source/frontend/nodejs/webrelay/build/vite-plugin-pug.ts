import { resolve } from 'node:path';
import pug from 'pug';
import type { Plugin } from 'vite';

/**
 * Matches `<pug src="path/to/template.pug"></pug>` placeholders in an HTML entry.
 * The path is resolved against the Vite root; a leading slash is allowed.
 */
const PUG_PLACEHOLDER = /<pug\s+src="([^"]+)"\s*(?:\/>|>\s*<\/pug>)/g;

export interface PugTemplatesOptions {
  /** Variables exposed to every template. */
  readonly locals?: Readonly<Record<string, unknown>>;
}

/**
 * Replaces every Pug placeholder in `html` with the rendered template.
 * Pure apart from reading the template files; exported for testing.
 */
export function renderPugPlaceholders(
  html: string,
  root: string,
  locals: Readonly<Record<string, unknown>> = {},
): string {
  return html.replace(PUG_PLACEHOLDER, (_match, src: string) => {
    const file = resolve(root, src.replace(/^\//, ''));
    return pug.renderFile(file, { ...locals, basedir: root, cache: false });
  });
}

/**
 * Vite plugin: lets `index.html` delegate its markup to Pug templates.
 * Runs before Vite processes the HTML, so `<script type="module">` tags emitted
 * by the templates are bundled normally.
 */
export function pugTemplates(options: PugTemplatesOptions = {}): Plugin {
  let root = process.cwd();
  return {
    name: 'ether-webrelay:pug',
    configResolved(config) {
      root = config.root;
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => renderPugPlaceholders(html, root, options.locals),
    },
    handleHotUpdate({ file, server }) {
      if (file.endsWith('.pug')) {
        server.ws.send({ type: 'full-reload' });
        return [];
      }
      return undefined;
    },
  };
}
