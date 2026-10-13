import type { TrackConfig } from '../domain/protocol';

export interface EncodedChunk {
  readonly track: 'video' | 'audio';
  readonly keyframe: boolean;
  readonly timestampUs: number;
  readonly durationUs: number;
  readonly data: Uint8Array;
}

export interface MediaPipelineSink {
  /** Emitted on start and whenever the encoder's decoder configuration changes. */
  onConfig(config: TrackConfig): void;
  onChunk(chunk: EncodedChunk): void;
  /** Unrecoverable failure (capture ended, encoder crashed). */
  onError(error: Error): void;
}

/**
 * Driven port: everything between the user's devices and encoded chunks —
 * capture, compositing, audio mixing and encoding. The browser adapter uses
 * getUserMedia/getDisplayMedia + Web Audio + WebCodecs; tests use fakes.
 */
export interface MediaPipelinePort {
  start(sink: MediaPipelineSink): Promise<void>;
  /** Ask the video encoder for a keyframe as soon as possible. */
  requestKeyframe(): void;
  stop(): Promise<void>;
}
