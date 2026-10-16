import type { MediaTrackLike } from './media';
import type { ProcessedTrack } from './video-effects';

/** What to apply to the microphone before publishing it. */
export interface AudioEnhancement {
  /** Neural noise suppression (RNNoise). */
  readonly rnnoise: boolean;
  /** Compression, make-up gain and a peak limiter. */
  readonly leveler: boolean;
}

/**
 * Driven port: advanced microphone processing. `apply` never throws: when it cannot
 * process (blocked audio, no AudioWorklet, the wasm did not load) it returns the source
 * track itself, which tells the caller nothing was applied, and explains in `status`.
 */
export interface AudioEnhancerPort {
  apply(source: MediaTrackLike, options: AudioEnhancement): Promise<ProcessedTrack>;
  /** Progress or failure text for the settings dialog; empty when all is well. */
  readonly status: string;
}

/** No processing: the microphone is published as captured. */
export const passthroughAudio: AudioEnhancerPort = {
  status: '',
  apply: async (source) => ({ track: source, stop: () => undefined }),
};
