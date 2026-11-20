import type { VideoEffect } from '../domain/preferences';
import type { MediaTrackLike } from './media';

export interface ProcessedTrack {
  readonly track: MediaTrackLike;
  /** Releases processing resources (not the source track). */
  stop(): void;
}

/**
 * Driven port: camera effects applied before publishing: background blur/replacement and, with
 * `framing`, automatic framing (crop and zoom that keep the face centered).
 */
export interface VideoEffectsPort {
  apply(source: MediaTrackLike, effect: VideoEffect, framing?: boolean): Promise<ProcessedTrack>;
}

/** No processing: the camera track is published as captured. */
export const passthroughEffects: VideoEffectsPort = {
  apply: async (source) => ({ track: source, stop: () => undefined }),
};
