import type { MediaTrackLike } from './media';

/** A transcription in progress; stopping it releases the engine's resources. */
export interface TranscriptionSession {
  stop(): void;
}

/**
 * Driven port: speech-to-text on the guest's own microphone, in the browser. The audio never
 * leaves the machine; only the resulting text is sent to the bridge (live captions).
 */
export interface TranscriberPort {
  /** False when this build or browser has no engine: the captions option is then not offered. */
  readonly available: boolean;
  /** Why it is not working (or what it is doing), for the settings. Empty when all is well. */
  readonly status: string;
  /**
   * Starts listening to `track`. `onLine` receives the line being said, again and again as the
   * engine refines it (each call replaces the previous one); '' means silence. Rejects if the
   * engine cannot start (the caller keeps the call running without captions).
   */
  start(track: MediaTrackLike, onLine: (text: string) => void): Promise<TranscriptionSession>;
}

/** No engine: the option is not offered. */
export const noTranscriber: TranscriberPort = {
  available: false,
  status: '',
  start: () => Promise.reject(new Error('no hay motor de transcripción')),
};
