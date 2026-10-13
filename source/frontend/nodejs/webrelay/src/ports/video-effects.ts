import type { VideoEffect } from '../domain/preferences';
import type { MediaTrackLike } from './media';

export interface ProcessedTrack {
  readonly track: MediaTrackLike;
  /** Releases processing resources (not the source track). */
  stop(): void;
}

/** Driven port: camera effects (background blur/replacement) applied before publishing. */
export interface VideoEffectsPort {
  apply(source: MediaTrackLike, effect: VideoEffect): Promise<ProcessedTrack>;
}

/** No processing: the camera track is published as captured. */
export const passthroughEffects: VideoEffectsPort = {
  apply: async (source) => ({ track: source, stop: () => undefined }),
};
