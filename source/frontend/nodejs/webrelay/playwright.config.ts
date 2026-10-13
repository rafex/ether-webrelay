import { defineConfig } from '@playwright/test';

/**
 * Browser E2E: the real app (Vite dev server) against the local dev bridge
 * (tests/support/dev-bridge.mjs), with Chromium's fake camera/microphone.
 * PW_CHANNEL=chrome uses an installed Google Chrome; in the E2E container the
 * bundled Chromium is used.
 */
export const BRIDGE_PORT = 18090;
export const APP_PORT = 15173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
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
    {
      command: `node tests/support/dev-bridge.mjs --port ${BRIDGE_PORT}`,
      port: BRIDGE_PORT,
      reuseExistingServer: false,
    },
    {
      command: `npx vite --port ${APP_PORT} --strictPort`,
      url: `http://localhost:${APP_PORT}/config.json`,
      reuseExistingServer: false,
    },
  ],
});
