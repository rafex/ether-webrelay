import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { BRIDGE_PORT, BRIDGE_URL, EXTERNAL_APP_URL } from '../../playwright.config';

/**
 * Live captions with the real engine: Whisper tiny (WebAssembly, in a worker) and the capture
 * AudioWorklet, loaded from the built image under the production CSP. The microphone plays a
 * recorded Spanish sentence; the dev bridge keeps the caption lines it receives and the test reads
 * them. The segmentation, the text cleaning and the queue are covered by unit tests; this proves
 * the pieces work together in a real browser and break no policy. Against the Vite dev server the
 * model is not there, so it only runs with E2E_APP_URL.
 */
test.skip(!EXTERNAL_APP_URL, 'needs the built image (E2E_APP_URL): the model is self-hosted there');
test.skip(Boolean(process.env.E2E_BRIDGE_URL), 'reads the lines from the local dev bridge');

const ROOM = 'captions-e2e';

/** The microphone repeats the recorded sentence, then 2 s of silence, forever. */
function speakingMicrophone(): void {
  const devices = navigator.mediaDevices;
  const original = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    const stream = new MediaStream();
    if (constraints?.video) {
      for (const track of (await original({ video: constraints.video })).getTracks()) {
        stream.addTrack(track);
      }
    }
    if (constraints?.audio) {
      const context = new AudioContext();
      const speech = await context.decodeAudioData(
        await (await fetch('/__fixture/speech-es.wav')).arrayBuffer(),
      );
      const looped = context.createBuffer(
        1,
        speech.length + 2 * speech.sampleRate,
        speech.sampleRate,
      );
      looped.getChannelData(0).set(speech.getChannelData(0));
      const source = context.createBufferSource();
      source.buffer = looped;
      source.loop = true;
      const destination = context.createMediaStreamDestination();
      source.connect(destination);
      source.start();
      for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    }
    return stream;
  };
}

test('a guest who speaks gets captions from the in-browser engine', async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.addInitScript(speakingMicrophone);
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  await page.route('**/__fixture/speech-es.wav', (route) =>
    route.fulfill({
      contentType: 'audio/wav',
      body: readFileSync(new URL('../fixtures/speech-es.wav', import.meta.url)),
    }),
  );
  // Only the app's own config.json: the model has one too (/captions/whisper-tiny/config.json).
  await page.route(
    (url) => url.pathname === '/config.json',
    (route) =>
      route.fulfill({
        json: {
          bridgeUrl: BRIDGE_URL,
          transport: 'webrtc',
          defaultView: 'stage',
          effectsModelUrl: '/models/selfie_segmenter.tflite',
          faceModelUrl: '/models/blaze_face_short_range.tflite',
          captionsUrl: '/captions/',
        },
      }),
  );

  // Nothing may come from a third party (the speech engine ships with the site).
  const origins = new Set<string>();
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) origins.add(new URL(request.url()).origin);
  });

  await page.goto(`/join/${ROOM}?t=e2e`);
  await expect(page.locator('#room-title')).toContainText(ROOM);

  await page.locator('#lobby-settings').click();
  await page.locator('button.settings-tab[data-section="audio"]').click();
  await expect(page.locator('#captions-field')).toBeVisible(); // the engine is configured
  await page.locator('label:has(#set-captions)').click();
  await expect(page.locator('#set-captions')).toBeChecked();
  await page.keyboard.press('Escape');

  await page.locator('#join-name').fill('Ana');
  await page.locator('#join-button').click();
  await expect(page.locator('#call-badge')).toHaveText('En la sala');

  // The guest is told the model is loading and when captions are on.
  await expect(page.locator('#toasts')).toContainText('Subtítulos en vivo activados.', {
    timeout: 120_000,
  });

  const lines = async (): Promise<string[]> =>
    (await (
      await request.get(`http://127.0.0.1:${BRIDGE_PORT}/__test/captions?room=${ROOM}`)
    ).json()) as string[];
  await expect
    .poll(async () => (await lines()).join(' '), { timeout: 150_000, intervals: [1000] })
    .toMatch(/bienvenidos/i);
  expect((await lines()).join(' ')).toMatch(/transmisi[óo]n/i);

  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  expect([...origins]).toEqual([new URL(EXTERNAL_APP_URL ?? '').origin]);
});
