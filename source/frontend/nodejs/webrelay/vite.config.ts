import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { pugTemplates } from './build/vite-plugin-pug.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  plugins: [pugTemplates({ locals: { appVersion: pkg.version, protocolVersion: 1 } })],
  // ffmpeg.wasm spawns its own module worker; pre-bundling breaks its relative URLs.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  worker: { format: 'es' },
  // No source maps in the build: they would be served next to the bundle and publish the
  // whole TypeScript source. Debug with `just dev` (Vite serves them in development).
  build: { target: 'es2023', sourcemap: false },
  server: { host: 'localhost', port: 5173, strictPort: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/application/**', 'src/infrastructure/transport/**'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
