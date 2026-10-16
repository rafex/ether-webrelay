import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import type { AudioEnhancement, AudioEnhancerPort } from '../../ports/audio-enhancer';
import type { MediaTrackLike } from '../../ports/media';
import type { ProcessedTrack } from '../../ports/video-effects';
import levelerWorkletUrl from './leveler.worklet.ts?worker&url';

/** RNNoise only works at 48 kHz. */
const SAMPLE_RATE = 48_000;

/**
 * AudioEnhancerPort over the Web Audio API: RNNoise (neural noise suppression, wasm in an
 * AudioWorklet) and/or the voice leveler, between the microphone and the published track.
 * Everything is loaded on first use; any failure returns the untouched microphone and says
 * why in `status`, so a call never loses its voice because of an enhancement.
 */
export class WebAudioEnhancer implements AudioEnhancerPort {
  private statusText = '';
  private wasm: Promise<ArrayBuffer> | undefined;

  get status(): string {
    return this.statusText;
  }

  async apply(source: MediaTrackLike, options: AudioEnhancement): Promise<ProcessedTrack> {
    const passthrough: ProcessedTrack = { track: source, stop: () => undefined };
    if (!options.rnnoise && !options.leveler) return passthrough;

    let context: AudioContext | undefined;
    try {
      if (typeof AudioContext === 'undefined' || !('audioWorklet' in AudioContext.prototype)) {
        throw new Error('este navegador no admite AudioWorklet');
      }
      this.statusText = options.rnnoise ? 'Cargando la supresión de ruido…' : '';
      context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
      const microphone = context.createMediaStreamSource(
        new MediaStream([source as MediaStreamTrack]),
      );
      let tail: AudioNode = microphone;

      if (options.rnnoise) {
        tail = await this.connectRnnoise(context, tail);
      }
      if (options.leveler) {
        tail = await this.connectLeveler(context, tail);
      }
      const destination = context.createMediaStreamDestination();
      tail.connect(destination);
      const output = destination.stream.getAudioTracks()[0];
      if (!output) throw new Error('no se pudo crear la pista de audio procesada');

      const resumeOnGesture = await startOrDefer(context);
      this.statusText = resumeOnGesture
        ? 'El navegador pausó el audio avanzado: empezará con tu primer clic.'
        : '';

      const running = context;
      // The destination track never ends by itself: pass on the loss of the microphone.
      const onEnded = () => {
        output.dispatchEvent(new Event('ended'));
        output.stop();
      };
      source.addEventListener('ended', onEnded);
      return {
        track: output,
        stop: () => {
          source.removeEventListener('ended', onEnded);
          resumeOnGesture?.();
          output.stop();
          microphone.disconnect();
          void running.close().catch(() => undefined);
        },
      };
    } catch (error) {
      void context?.close().catch(() => undefined);
      this.wasm = undefined; // retry the download next time
      this.statusText = `El audio avanzado no está disponible: ${(error as Error).message}`;
      return passthrough;
    }
  }

  private async connectRnnoise(context: AudioContext, input: AudioNode): Promise<AudioNode> {
    const { RnnoiseWorkletNode, loadRnnoise } = await import('@sapphi-red/web-noise-suppressor');
    this.wasm ??= loadRnnoise({ url: rnnoiseWasmPath, simdUrl: rnnoiseSimdWasmPath });
    const wasmBinary = await this.wasm;
    await context.audioWorklet.addModule(rnnoiseWorkletPath);
    const node = new RnnoiseWorkletNode(context, { wasmBinary, maxChannels: 2 });
    input.connect(node);
    return node;
  }

  private async connectLeveler(context: AudioContext, input: AudioNode): Promise<AudioNode> {
    await context.audioWorklet.addModule(levelerWorkletUrl);
    const node = new AudioWorkletNode(context, 'voice-leveler', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    input.connect(node);
    return node;
  }
}

/**
 * Browsers start an AudioContext suspended until the page has had a user gesture. If it does
 * not start at once, resume it on the first interaction (joining the call is one) and return
 * the function that removes those listeners; otherwise return undefined.
 */
async function startOrDefer(context: AudioContext): Promise<(() => void) | undefined> {
  await Promise.race([
    context.resume().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 400)),
  ]);
  if (context.state === 'running') return undefined;
  const events = ['pointerdown', 'keydown', 'touchstart'] as const;
  const resume = () => {
    void context.resume().then(() => remove());
  };
  const remove = () => {
    for (const event of events) document.removeEventListener(event, resume, true);
  };
  for (const event of events) document.addEventListener(event, resume, true);
  return remove;
}
