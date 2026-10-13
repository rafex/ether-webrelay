import { AudioTimeline } from '../domain/audio-timeline';
import { RelayError, RelayErrorCode } from '../domain/errors';
import { KeyframeScheduler } from '../domain/keyframe-scheduler';
import { MediaClock } from '../domain/media-clock';
import type { RelaySettings } from '../domain/relay-settings';
import type { MediaPipelinePort, MediaPipelineSink } from '../ports/media-pipeline';
import { type MixerInput, WebAudioMixer } from './audio/web-audio-mixer';
import {
  assertBrowserSupport,
  type CapturedMedia,
  captureMedia,
} from './capture/browser-media-capture';
import { CanvasCompositor } from './capture/canvas-compositor';
import {
  selectAudioCodec,
  selectVideoCodec,
  WebCodecsAudioEncoder,
  WebCodecsVideoEncoder,
} from './encoding/webcodecs-encoders';
import { performanceTimeSource } from './time/performance-time-source';

/**
 * Browser adapter for MediaPipelinePort:
 * getUserMedia/getDisplayMedia → canvas compositor + Web Audio mixer → WebCodecs.
 * Audio and video share one MediaClock so the bridge can interleave them.
 */
export class BrowserMediaPipeline implements MediaPipelinePort {
  private readonly clock = new MediaClock(performanceTimeSource);
  private readonly keyframes: KeyframeScheduler;
  private media: CapturedMedia | undefined;
  private compositor: CanvasCompositor | undefined;
  private mixer: WebAudioMixer | undefined;
  private videoEncoder: WebCodecsVideoEncoder | undefined;
  private audioEncoder: WebCodecsAudioEncoder | undefined;

  constructor(private readonly settings: RelaySettings) {
    this.keyframes = new KeyframeScheduler(settings.keyframeIntervalSec * 1_000_000);
  }

  /** Composite audio+video for local preview and recording (available after start). */
  get previewStream(): MediaStream | undefined {
    if (!this.compositor) return undefined;
    const stream = this.compositor.captureStream();
    for (const track of this.mixer?.stream.getAudioTracks() ?? []) stream.addTrack(track);
    return stream;
  }

  get audioMixer(): WebAudioMixer | undefined {
    return this.mixer;
  }

  async start(sink: MediaPipelineSink): Promise<void> {
    assertBrowserSupport();
    const { sources, video } = this.settings;
    try {
      this.media = await captureMedia(sources, video);
      this.media.onScreenEnded(() =>
        sink.onError(
          new RelayError(RelayErrorCode.NoSources, 'Se detuvo la compartición de pantalla.'),
        ),
      );

      const selectedVideo = await selectVideoCodec(video);
      if (!selectedVideo) {
        throw new RelayError(
          RelayErrorCode.CodecUnsupported,
          'No hay codificador de video compatible (H.264 o VP8) para esta configuración.',
        );
      }
      this.videoEncoder = new WebCodecsVideoEncoder(selectedVideo, sink);

      const mixerInputs: MixerInput[] = [];
      if (this.media.microphone)
        mixerInputs.push({ id: 'microphone', track: this.media.microphone });
      if (this.media.systemAudio)
        mixerInputs.push({ id: 'systemAudio', track: this.media.systemAudio });

      this.clock.start();
      if (mixerInputs.length > 0) await this.startAudio(mixerInputs, sink);

      const videoEncoder = this.videoEncoder;
      this.compositor = new CanvasCompositor(
        {
          ...(this.media.screen ? { screen: this.media.screen } : {}),
          ...(this.media.camera ? { camera: this.media.camera } : {}),
          width: video.width,
          height: video.height,
          framerate: video.framerate,
          clock: this.clock,
        },
        (frame) => {
          const key = this.keyframes.shouldForceKeyframe(frame.timestamp);
          if (!videoEncoder.encode(frame, key) && key) this.keyframes.request();
        },
      );
      await this.compositor.start();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  requestKeyframe(): void {
    this.keyframes.request();
  }

  async stop(): Promise<void> {
    this.compositor?.stop();
    this.compositor = undefined;
    await this.mixer?.close();
    this.mixer = undefined;
    await Promise.all([this.videoEncoder?.close(), this.audioEncoder?.close()]);
    this.videoEncoder = undefined;
    this.audioEncoder = undefined;
    this.media?.stop();
    this.media = undefined;
  }

  private async startAudio(inputs: MixerInput[], sink: MediaPipelineSink): Promise<void> {
    const { audio } = this.settings;
    let timeline: AudioTimeline | undefined;
    this.mixer = await WebAudioMixer.create(
      inputs,
      audio.sampleRate,
      audio.channels,
      (planes, frames) => {
        if (!this.audioEncoder || !timeline) return;
        this.audioEncoder.encode(planes, frames, timeline.next(frames, this.clock.nowUs()));
      },
    );
    const sampleRate = this.mixer.sampleRate;
    const selectedAudio = await selectAudioCodec(audio, sampleRate);
    if (!selectedAudio) {
      throw new RelayError(
        RelayErrorCode.CodecUnsupported,
        `No hay codificador de audio compatible (AAC u Opus) a ${sampleRate} Hz.`,
      );
    }
    timeline = new AudioTimeline(sampleRate);
    this.audioEncoder = new WebCodecsAudioEncoder(selectedAudio, sink);
  }
}
