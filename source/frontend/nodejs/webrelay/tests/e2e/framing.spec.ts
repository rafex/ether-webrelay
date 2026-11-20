import { expect, test } from '@playwright/test';
import { BRIDGE_URL, EXTERNAL_APP_URL } from '../../playwright.config';

/**
 * Automatic framing needs the face detector (a MediaPipe wasm runtime and a model). Against the
 * built image it must load both from the site itself and run under the production CSP. Chromium's
 * fake camera has no face, so what is checked here is that the pipeline starts, keeps the preview
 * alive and breaks no policy; the framing geometry is covered in tests/unit/framing.test.ts.
 * Against the Vite dev server the model would come from Google (no network guarantee), so it is
 * only run with E2E_APP_URL.
 */
test.skip(!EXTERNAL_APP_URL, 'needs the built image (E2E_APP_URL): the model is self-hosted there');

test('automatic framing starts under the production CSP and keeps the preview alive', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  await page.route('**/config.json', (route) =>
    route.fulfill({
      json: {
        bridgeUrl: BRIDGE_URL,
        transport: 'webrtc',
        defaultView: 'stage',
        effectsModelUrl: '/models/selfie_segmenter.tflite',
        faceModelUrl: '/models/blaze_face_short_range.tflite',
      },
    }),
  );
  const loaded: string[] = [];
  page.on('requestfinished', (request) => loaded.push(new URL(request.url()).pathname));

  await page.goto('/join/e2e-framing?t=e2e');
  await expect(page.locator('#room-title')).toContainText('e2e-framing');

  await page.locator('#lobby-settings').click();
  await page.locator('#video-tab-effects').click();
  await page.locator('label:has(#set-framing)').click();
  await expect(page.locator('#set-framing')).toBeChecked();

  await expect
    .poll(() => loaded.some((path) => path.endsWith('blaze_face_short_range.tflite')), {
      timeout: 20_000,
    })
    .toBe(true);
  await page.waitForTimeout(3000); // let the detector run a few passes

  await expect(page.locator('#framing-status')).toHaveText('');
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  // The processed track still delivers frames.
  await expect
    .poll(() => page.locator('#settings-preview').evaluate((v: HTMLVideoElement) => v.videoWidth), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
});
