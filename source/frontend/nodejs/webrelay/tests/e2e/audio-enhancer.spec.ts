import { expect, type Page, test } from '@playwright/test';
import { BRIDGE_URL } from '../../playwright.config';

/**
 * The real pipeline (RNNoise and the voice leveler, both in AudioWorklets) fed with synthetic
 * signals in Chromium, measured with an AnalyserNode. The numbers are loose on purpose: they
 * prove the effect exists and is the right sign and size, not a specific tuning. The leveler's
 * exact behaviour is covered sample by sample in tests/unit/leveler-dsp.test.ts.
 */

const db = (ratio: number) => 20 * Math.log10(ratio);

interface Measure {
  inRms: number;
  outRms: number;
  outPeak: number;
  status: string;
  processed: boolean;
}

type Signal = 'fan' | 'voice' | 'voice-and-fan' | 'hot-sine' | 'quiet-sine';

async function run(
  page: Page,
  signal: Signal,
  options: { rnnoise: boolean; leveler: boolean },
): Promise<Measure> {
  const result = await page.evaluate(
    async ({ signal, options }) => {
      const { WebAudioEnhancer } = await import(
        '/src/infrastructure/audio/web-audio-enhancer.ts' as string
      );
      const rate = 48_000;
      const ctx = new AudioContext({ sampleRate: rate });
      await ctx.resume();
      const sink = ctx.createMediaStreamDestination();
      const fan = () => {
        // A fan: low-pass noise plus the mains hum, around -25 dBFS.
        const buffer = ctx.createBuffer(1, rate * 2, rate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;
        const low = ctx.createBiquadFilter();
        low.type = 'lowpass';
        low.frequency.value = 500;
        const level = ctx.createGain();
        level.gain.value = 0.5;
        noise.connect(low).connect(level).connect(sink);
        noise.start();
        const hum = ctx.createOscillator();
        hum.frequency.value = 100;
        const humLevel = ctx.createGain();
        humLevel.gain.value = 0.01;
        hum.connect(humLevel).connect(sink);
        hum.start();
      };
      const voice = () => {
        // Vowel-like: a 130 Hz pulse train through two formants, opened and closed ~3 times a second.
        const source = ctx.createOscillator();
        source.type = 'sawtooth';
        source.frequency.value = 130;
        const syllables = ctx.createGain();
        syllables.gain.value = 0.5;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 3;
        const depth = ctx.createGain();
        depth.gain.value = 0.5;
        lfo.connect(depth).connect(syllables.gain);
        lfo.start();
        const out = ctx.createGain();
        out.gain.value = 0.6;
        for (const [frequency, q] of [
          [700, 5],
          [1200, 5],
        ] as const) {
          const formant = ctx.createBiquadFilter();
          formant.type = 'bandpass';
          formant.frequency.value = frequency;
          formant.Q.value = q;
          source.connect(syllables).connect(formant).connect(out);
        }
        out.connect(sink);
        source.start();
      };
      if (signal === 'fan' || signal === 'voice-and-fan') fan();
      if (signal === 'voice' || signal === 'voice-and-fan') voice();
      if (signal === 'hot-sine' || signal === 'quiet-sine') {
        const osc = ctx.createOscillator();
        osc.frequency.value = 220;
        const gain = ctx.createGain();
        gain.gain.value = signal === 'hot-sine' ? 0.9 : 0.02;
        osc.connect(gain).connect(sink);
        osc.start();
      }
      const input = sink.stream.getAudioTracks()[0] as MediaStreamTrack;
      const enhancer = new WebAudioEnhancer();
      const processed = await enhancer.apply(input as never, options);

      const probe = async (track: MediaStreamTrack) => {
        const c = new AudioContext({ sampleRate: rate });
        await c.resume();
        const a = c.createAnalyser();
        a.fftSize = 2048;
        c.createMediaStreamSource(new MediaStream([track])).connect(a);
        return { c, a, buf: new Float32Array(a.fftSize) };
      };
      const inProbe = await probe(input);
      const outProbe = await probe(processed.track as unknown as MediaStreamTrack);
      await new Promise((r) => setTimeout(r, 2500)); // let RNNoise/compressor settle
      let inSum = 0;
      let outSum = 0;
      let outPeak = 0;
      let n = 0;
      for (let k = 0; k < 40; k++) {
        inProbe.a.getFloatTimeDomainData(inProbe.buf);
        outProbe.a.getFloatTimeDomainData(outProbe.buf);
        for (let i = 0; i < inProbe.buf.length; i++) {
          const x = inProbe.buf[i] ?? 0;
          const y = outProbe.buf[i] ?? 0;
          inSum += x * x;
          outSum += y * y;
          outPeak = Math.max(outPeak, Math.abs(y));
          n++;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      const result = {
        inRms: Math.sqrt(inSum / n),
        outRms: Math.sqrt(outSum / n),
        outPeak,
        status: enhancer.status,
        processed: processed.track !== (input as unknown),
      };
      processed.stop();
      await Promise.all([inProbe.c.close(), outProbe.c.close(), ctx.close()]);
      return result;
    },
    { signal, options },
  );
  if (process.env.AUDIO_DEBUG) {
    console.log(
      `[${signal} ${JSON.stringify(options)}] entrada RMS ${db(result.inRms).toFixed(1)} dBFS -> salida RMS ${db(result.outRms).toFixed(1)} dBFS (${db(result.outRms / result.inRms).toFixed(1)} dB), pico ${db(result.outPeak).toFixed(1)} dBFS, estado '${result.status}'`,
    );
  }
  return result;
}

test.describe('advanced microphone processing (real pipeline)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/config.json', (route) => route.fulfill({ json: {} }));
    await page.goto('/');
  });

  test('RNNoise removes a fan', async ({ page }) => {
    const m = await run(page, 'fan', { rnnoise: true, leveler: false });
    expect(m.processed, m.status).toBe(true);
    expect(m.status).toBe('');
    expect(db(m.outRms / m.inRms)).toBeLessThan(-30);
  });

  test('RNNoise leaves a voice alone', async ({ page }) => {
    const m = await run(page, 'voice', { rnnoise: true, leveler: false });
    expect(m.processed, m.status).toBe(true);
    expect(db(m.outRms / m.inRms)).toBeGreaterThan(-3);
  });

  test('RNNoise keeps the voice and drops the fan when both are there', async ({ page }) => {
    const voice = await run(page, 'voice', { rnnoise: true, leveler: false });
    const both = await run(page, 'voice-and-fan', { rnnoise: true, leveler: false });
    // What comes out is the voice at the level it had alone, and less than what went in.
    expect(Math.abs(db(both.outRms / voice.outRms))).toBeLessThan(3);
    expect(db(both.outRms / both.inRms)).toBeLessThan(-3);
  });

  test('the leveler keeps hot peaks under the ceiling', async ({ page }) => {
    const m = await run(page, 'hot-sine', { rnnoise: false, leveler: true });
    expect(m.processed, m.status).toBe(true);
    expect(db(m.outPeak)).toBeLessThan(-1.5); // the input peaks at -0.9 dBFS
    expect(m.outRms).toBeGreaterThan(0.05); // and it is not silenced
  });

  test('the leveler lifts quiet speech by a bounded amount', async ({ page }) => {
    const m = await run(page, 'quiet-sine', { rnnoise: false, leveler: true });
    const gain = db(m.outRms / m.inRms);
    expect(gain).toBeGreaterThan(6);
    expect(gain).toBeLessThan(12.5);
  });

  test('without options nothing is touched', async ({ page }) => {
    const m = await run(page, 'quiet-sine', { rnnoise: false, leveler: false });
    expect(m.processed).toBe(false);
    expect(Math.abs(db(m.outRms / m.inRms))).toBeLessThan(0.5);
  });

  test('if RNNoise cannot load the microphone is returned untouched, with a reason', async ({
    page,
  }) => {
    await page.route('**/*.wasm*', (route) => route.abort());
    const m = await run(page, 'quiet-sine', { rnnoise: true, leveler: true });
    expect(m.processed).toBe(false);
    expect(m.status).toContain('El audio avanzado no está disponible');
    expect(Math.abs(db(m.outRms / m.inRms))).toBeLessThan(0.5);
  });
});

/**
 * Through the settings dialog, the way a guest turns it on. Run against the built image
 * (E2E_APP_URL) this also proves the production CSP lets both worklets and the wasm load.
 */
test('turning the advanced audio on in the settings works and breaks no security policy', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
    // Same synthetic microphone as the call tests: the fake device hangs in some headless hosts.
    const devices = navigator.mediaDevices;
    const original = devices.getUserMedia.bind(devices);
    devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const stream = new MediaStream();
      if (constraints?.video) {
        for (const t of (await original({ video: constraints.video })).getTracks())
          stream.addTrack(t);
      }
      if (constraints?.audio) {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        for (const t of destination.stream.getAudioTracks()) stream.addTrack(t);
      }
      return stream;
    };
  });
  await page.route('**/config.json', (route) =>
    route.fulfill({ json: { bridgeUrl: BRIDGE_URL, transport: 'webrtc', defaultView: 'stage' } }),
  );
  const loaded: string[] = [];
  page.on('requestfinished', (request) => loaded.push(new URL(request.url()).pathname));
  await page.goto('/join/e2e-audio?t=e2e');
  await expect(page.locator('#room-title')).toContainText('e2e-audio');

  await page.locator('#lobby-settings').click();
  await page.locator('.settings-tab[data-section="audio"]').click();
  await page.locator('label:has(#set-rnnoise)').click();
  await page.locator('label:has(#set-leveler)').click();
  await expect(page.locator('#set-rnnoise')).toBeChecked();
  await expect(page.locator('#set-leveler')).toBeChecked();

  // Give it time to download the wasm and start both worklets, then see how it went. Worklet
  // downloads are not visible to the page, but a worklet that fails to load ends in the status.
  await page.waitForTimeout(4000);
  expect(
    loaded.some((path) => /rnnoise.*\.wasm$/.test(path)),
    'rnnoise wasm',
  ).toBe(true);
  await expect(page.locator('#audio-status')).not.toContainText('no está disponible');
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
});
