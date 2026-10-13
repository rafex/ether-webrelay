import {
  audioCandidates,
  type CodecCandidate,
  selectCodec,
  videoCandidates,
} from '../../domain/codec-selection';
import {
  type AudioCodecFamily,
  type AudioTrackConfig,
  bytesToBase64,
  type VideoCodecFamily,
  type VideoTrackConfig,
} from '../../domain/protocol';
import type { AudioSettings, VideoSettings } from '../../domain/relay-settings';
import type { EncodedChunk } from '../../ports/media-pipeline';

/** Frames waiting inside the encoder before new ones are dropped (keeps latency bounded). */
const MAX_VIDEO_QUEUE = 3;

export interface EncoderCallbacks<C> {
  onConfig(config: C): void;
  onChunk(chunk: EncodedChunk): void;
  onError(error: Error): void;
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

export interface SelectedVideoCodec {
  readonly candidate: CodecCandidate<VideoCodecFamily>;
  readonly config: VideoEncoderConfig;
}

export function buildVideoEncoderConfig(
  candidate: CodecCandidate<VideoCodecFamily>,
  video: VideoSettings,
  bitrateMode: VideoEncoderBitrateMode | undefined,
): VideoEncoderConfig {
  return {
    codec: candidate.codec,
    width: video.width,
    height: video.height,
    bitrate: video.bitrate,
    framerate: video.framerate,
    latencyMode: 'realtime',
    hardwareAcceleration: 'prefer-hardware',
    ...(bitrateMode ? { bitrateMode } : {}),
    // AVCC + avcC description: what FLV/RTMP needs, no Annex-B start codes to strip.
    ...(candidate.family === 'h264' ? { avc: { format: 'avc' as const } } : {}),
  };
}

/** Probes codecs in preference order; CBR first (preferred by ingest servers), then VBR. */
export async function selectVideoCodec(
  video: VideoSettings,
): Promise<SelectedVideoCodec | undefined> {
  const options = videoCandidates(video.width, video.height, video.framerate, video.codec).flatMap(
    (candidate) =>
      (['constant', undefined] as const).map((mode) => ({
        candidate,
        config: buildVideoEncoderConfig(candidate, video, mode),
      })),
  );
  return selectCodec(options, async ({ config }) => {
    const support = await VideoEncoder.isConfigSupported(config);
    return support.supported === true;
  });
}

export class WebCodecsVideoEncoder {
  private readonly encoder: VideoEncoder;
  private lastDescription: string | undefined;
  private droppedFrames = 0;

  constructor(
    private readonly selected: SelectedVideoCodec,
    private readonly callbacks: EncoderCallbacks<VideoTrackConfig>,
  ) {
    this.encoder = new VideoEncoder({
      output: (chunk, metadata) => this.handleOutput(chunk, metadata),
      error: (error) => callbacks.onError(error),
    });
    this.encoder.configure(selected.config);
  }

  get dropped(): number {
    return this.droppedFrames;
  }

  /**
   * Encodes and closes `frame`. Returns false when the frame was dropped
   * because the encoder is falling behind (the caller should re-request a
   * keyframe if this one was meant to be key).
   */
  encode(frame: VideoFrame, keyFrame: boolean): boolean {
    try {
      if (this.encoder.state !== 'configured' || this.encoder.encodeQueueSize > MAX_VIDEO_QUEUE) {
        this.droppedFrames++;
        return false;
      }
      this.encoder.encode(frame, { keyFrame });
      return true;
    } finally {
      frame.close();
    }
  }

  async close(): Promise<void> {
    if (this.encoder.state === 'closed') return;
    await this.encoder.flush().catch(() => undefined);
    closeQuietly(this.encoder);
  }

  private handleOutput(chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata): void {
    const description = metadata?.decoderConfig?.description;
    if (metadata?.decoderConfig) {
      const encoded = description ? bytesToBase64(toBytes(description)) : undefined;
      // Re-announce only when the decoder configuration actually changes.
      if ((encoded ?? '') !== this.lastDescription) {
        this.lastDescription = encoded ?? '';
        const { config, candidate } = this.selected;
        this.callbacks.onConfig({
          track: 'video',
          codec: metadata.decoderConfig.codec,
          family: candidate.family,
          width: metadata.decoderConfig.codedWidth ?? config.width,
          height: metadata.decoderConfig.codedHeight ?? config.height,
          framerate: config.framerate ?? 30,
          bitrate: config.bitrate ?? 0,
          ...(encoded ? { description: encoded } : {}),
        });
      }
    }
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.callbacks.onChunk({
      track: 'video',
      keyframe: chunk.type === 'key',
      timestampUs: chunk.timestamp,
      durationUs: chunk.duration ?? Math.round(1_000_000 / (this.selected.config.framerate ?? 30)),
      data,
    });
  }
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export interface SelectedAudioCodec {
  readonly candidate: CodecCandidate<AudioCodecFamily>;
  readonly config: AudioEncoderConfig;
}

export function buildAudioEncoderConfig(
  candidate: CodecCandidate<AudioCodecFamily>,
  audio: AudioSettings,
  sampleRate: number,
): AudioEncoderConfig {
  const base: AudioEncoderConfig = {
    codec: candidate.codec,
    sampleRate,
    numberOfChannels: audio.channels,
    bitrate: audio.bitrate,
  };
  return candidate.family === 'aac'
    ? // Raw AAC + AudioSpecificConfig description (FLV style), not ADTS.
      ({ ...base, aac: { format: 'aac' } } as AudioEncoderConfig)
    : { ...base, opus: { format: 'opus', frameDuration: 20_000 } };
}

export async function selectAudioCodec(
  audio: AudioSettings,
  sampleRate: number,
): Promise<SelectedAudioCodec | undefined> {
  const options = audioCandidates(audio.codec).map((candidate) => ({
    candidate,
    config: buildAudioEncoderConfig(candidate, audio, sampleRate),
  }));
  return selectCodec(options, async ({ config }) => {
    const support = await AudioEncoder.isConfigSupported(config);
    return support.supported === true;
  });
}

export class WebCodecsAudioEncoder {
  private readonly encoder: AudioEncoder;
  private configSent = false;

  constructor(
    private readonly selected: SelectedAudioCodec,
    private readonly callbacks: EncoderCallbacks<AudioTrackConfig>,
  ) {
    this.encoder = new AudioEncoder({
      output: (chunk, metadata) => this.handleOutput(chunk, metadata),
      error: (error) => callbacks.onError(error),
    });
    this.encoder.configure(selected.config);
  }

  /** Encodes planar Float32 PCM captured at `timestampUs`. */
  encode(planes: Float32Array[], frames: number, timestampUs: number): void {
    if (this.encoder.state !== 'configured') return;
    const channels = this.selected.config.numberOfChannels;
    const planar = new Float32Array(frames * channels);
    for (let channel = 0; channel < channels; channel++) {
      const plane = planes[channel] ?? planes[0];
      if (plane) planar.set(plane.subarray(0, frames), channel * frames);
    }
    const data = new AudioData({
      format: 'f32-planar',
      sampleRate: this.selected.config.sampleRate,
      numberOfFrames: frames,
      numberOfChannels: channels,
      timestamp: timestampUs,
      data: planar,
    });
    try {
      this.encoder.encode(data);
    } finally {
      data.close();
    }
  }

  async close(): Promise<void> {
    if (this.encoder.state === 'closed') return;
    await this.encoder.flush().catch(() => undefined);
    closeQuietly(this.encoder);
  }

  private handleOutput(chunk: EncodedAudioChunk, metadata?: EncodedAudioChunkMetadata): void {
    const decoderConfig = metadata?.decoderConfig;
    if (decoderConfig && !this.configSent) {
      this.configSent = true;
      const { config, candidate } = this.selected;
      this.callbacks.onConfig({
        track: 'audio',
        codec: decoderConfig.codec,
        family: candidate.family,
        sampleRate: decoderConfig.sampleRate,
        channels: decoderConfig.numberOfChannels,
        bitrate: config.bitrate ?? 0,
        ...(decoderConfig.description
          ? { description: bytesToBase64(toBytes(decoderConfig.description)) }
          : {}),
      });
    }
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.callbacks.onChunk({
      track: 'audio',
      keyframe: chunk.type === 'key',
      timestampUs: chunk.timestamp,
      durationUs: chunk.duration ?? 0,
      data,
    });
  }
}

function toBytes(source: AllowSharedBufferSource): Uint8Array {
  return source instanceof ArrayBuffer || source instanceof SharedArrayBuffer
    ? new Uint8Array(source.slice(0))
    : new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
}

/** The encoder may already be closed by an error callback while flushing. */
function closeQuietly(encoder: VideoEncoder | AudioEncoder): void {
  try {
    encoder.close();
  } catch {
    // already closed
  }
}
