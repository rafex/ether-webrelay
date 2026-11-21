import { SpeechSegmenter } from '../../domain/speech-segmenter';
import { cleanTranscript } from '../../domain/transcript';
import type { MediaTrackLike } from '../../ports/media';
import type { TranscriberPort, TranscriptionSession } from '../../ports/transcriber';
import captureWorkletUrl from './capture.worklet.ts?worker&url';
import { DecodeQueue } from './decode-queue';
import type { FromWorker, ToWorker } from './protocol';

/** The first load downloads ~70 MB; after that the browser has it. A dead worker must not hang. */
const LOAD_TIMEOUT_MS = 180_000;

/** Whisper's language code for the browser's language ("es-MX" → "es"); '' lets the model decide. */
export function whisperLanguage(browserLanguage: string | undefined): string {
  const code = browserLanguage?.split('-')[0]?.toLowerCase() ?? '';
  return /^[a-z]{2,3}$/.test(code) ? code : '';
}

function supported(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof WebAssembly === 'object' &&
    typeof AudioContext !== 'undefined' &&
    'audioWorklet' in AudioContext.prototype
  );
}

/**
 * TranscriberPort over Whisper tiny running in this browser (WebAssembly in a worker). The
 * microphone is cut into utterances (SpeechSegmenter); each is decoded and the text replaces the
 * caption line. Nothing but the text leaves the machine, and the model comes from the site itself.
 * It is loaded only when someone turns captions on.
 */
export class WhisperTranscriber implements TranscriberPort {
  private statusText = '';

  /** `baseUrl`: folder with `whisper-tiny/`; empty means this deployment has no engine. */
  constructor(
    private readonly baseUrl: string,
    private readonly language: string = whisperLanguage(
      typeof navigator === 'undefined' ? undefined : navigator.language,
    ),
  ) {}

  get available(): boolean {
    return this.baseUrl !== '' && supported();
  }

  get status(): string {
    return this.statusText;
  }

  async start(
    track: MediaTrackLike,
    onLine: (text: string) => void,
  ): Promise<TranscriptionSession> {
    if (!this.available) throw new Error('este navegador no puede transcribir');
    this.statusText = 'Cargando el modelo de voz (la primera vez baja ~70 MB)…';
    const worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
    let context: AudioContext | undefined;
    try {
      await ready(worker, this.baseUrl, this.language);

      context = new AudioContext({ latencyHint: 'balanced' });
      await context.audioWorklet.addModule(captureWorkletUrl);
      const source = context.createMediaStreamSource(new MediaStream([track as MediaStreamTrack]));
      const capture = new AudioWorkletNode(context, 'caption-capture');
      // The worklet is only pulled when it reaches the destination; its output is silence anyway.
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(capture).connect(mute).connect(context.destination);
      if (context.state === 'suspended') await context.resume().catch(() => undefined);

      const segmenter = new SpeechSegmenter();
      let stopped = false;
      const queue = new DecodeQueue((id, audio) => {
        const message: ToWorker = { type: 'decode', id, audio };
        worker.postMessage(message, [audio.buffer]);
      });
      capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (stopped) return;
        for (const utterance of segmenter.push(event.data)) queue.offer(utterance);
      };
      worker.onmessage = (event: MessageEvent<FromWorker>) => {
        const message = event.data;
        if (message.type === 'ready' || message.id === undefined) return;
        const job = queue.complete(message.id);
        if (stopped || !job || message.type !== 'text') return;
        const text = cleanTranscript(message.text);
        if (text !== '') onLine(text);
      };

      this.statusText = '';
      const owner = context;
      return {
        stop: () => {
          stopped = true;
          queue.clear();
          capture.port.onmessage = null;
          worker.onmessage = null;
          source.disconnect();
          capture.disconnect();
          worker.terminate();
          void owner.close().catch(() => undefined);
        },
      };
    } catch (error) {
      worker.terminate();
      void context?.close().catch(() => undefined);
      this.statusText = '';
      throw error;
    }
  }
}

/** Starts the worker's engine and resolves when it says it is ready. */
function ready(worker: Worker, baseUrl: string, language: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error('el motor tardó demasiado en cargar')),
      LOAD_TIMEOUT_MS,
    );
    const finish = (error?: Error) => {
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      if (error) reject(error);
      else resolve();
    };
    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (message.type === 'ready') finish();
      else if (message.type === 'error') finish(new Error(message.message));
    };
    worker.onerror = (event) => finish(new Error(event.message || 'el motor no pudo iniciar'));
    const init: ToWorker = { type: 'init', baseUrl, language };
    worker.postMessage(init);
  });
}
