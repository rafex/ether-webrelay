import { defineConfig } from '@playwright/test';

/**
 * Browser E2E: the real app (Vite dev server) against the local dev bridge
 * (tests/support/dev-bridge.mjs), with Chromium's fake camera/microphone.
 * PW_CHANNEL=chrome uses an installed Google Chrome; in the E2E container the
 * bundled Chromium is used.
 *
 * E2E_BRIDGE_URL=ws://host:port/signal runs the same scenarios against an
 * already running bridge instead (e.g. ether-streaming-culerin in
 * development mode); the dev bridge is then not started.
 *
 * E2E_APP_URL=http://host:port runs them against an already served build (the
 * container image behind nginx, with its real headers and CSP) instead of the
 * Vite dev server.
 */
export const BRIDGE_PORT = 18090;
export const APP_PORT = 15173;
export const EXTERNAL_BRIDGE_URL = process.env.E2E_BRIDGE_URL;
export const EXTERNAL_APP_URL = process.env.E2E_APP_URL;
export const BRIDGE_URL = EXTERNAL_BRIDGE_URL ?? `ws://127.0.0.1:${BRIDGE_PORT}/signal`;

const devBridge = {
  command: `node tests/support/dev-bridge.mjs --port ${BRIDGE_PORT}`,
  port: BRIDGE_PORT,
  reuseExistingServer: false,
};

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: EXTERNAL_APP_URL ?? `http://localhost:${APP_PORT}`,
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
    headless: true,
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--auto-select-desktop-capture-source=Entire screen',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
    trace: 'retain-on-failure',
  },
  webServer: [
    ...(EXTERNAL_BRIDGE_URL ? [] : [devBridge]),
    ...(EXTERNAL_APP_URL
      ? []
      : [
          {
            command: `npx vite --port ${APP_PORT} --strictPort`,
            url: `http://localhost:${APP_PORT}/config.json`,
            reuseExistingServer: false,
          },
        ]),
  ],
});
