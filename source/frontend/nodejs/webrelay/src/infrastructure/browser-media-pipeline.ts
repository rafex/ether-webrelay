import { AudioTimeline } from '../domain/audio-timeline';
import { RelayError, RelayErrorCode } from '../domain/errors';
import { KeyframeScheduler } from '../domain/keyframe-scheduler';
import { MediaClock } from '../domain/media-clock';
import type { RelaySettings } from '../domain/relay-settings';
import type {
  ComposableMediaPipelinePort,
  MediaPipelineSink,
  PipelineSources,
} from '../ports/media-pipeline';
import { type MixerInput, WebAudioMixer } from './audio/web-audio-mixer';
import { assertBrowserSupport } from './browser-support';
import { CanvasCompositor } from './capture/canvas-compositor';
import {
  selectAudioCodec,
  selectVideoCodec,
  WebCodecsAudioEncoder,
  WebCodecsVideoEncoder,
} from './encoding/webcodecs-encoders';
import { performanceTimeSource } from './time/performance-time-source';

/**
 * WebSocket-transport pipeline: already-open local tracks → canvas compositor
 * (screen + camera picture-in-picture) and Web Audio mixer → WebCodecs.
 * Audio and video share one MediaClock so the bridge can interleave them.
 * Sources can change while live; the audio track always exists (silence when muted).
 */
export class BrowserMediaPipeline implements ComposableMediaPipelinePort {
  private readonly clock = new MediaClock(performanceTimeSource);
  private readonly keyframes: KeyframeScheduler;
  private compositor: CanvasCompositor | undefined;
  private mixer: WebAudioMixer | undefined;
  private videoEncoder: WebCodecsVideoEncoder | undefined;
  private audioEncoder: WebCodecsAudioEncoder | undefined;

  constructor(
    private readonly settings: RelaySettings,
    private sources: PipelineSources,
    private readonly placeholder = '',
  ) {
    this.keyframes = new KeyframeScheduler(settings.keyframeIntervalSec * 1_000_000);
  }

  /** Composite audio+video for local preview and recording (available after start). */
  get previewStream(): MediaStream | undefined {
    if (!this.compositor) return undefined;
    const stream = this.compositor.captureStream();
    for (const track of this.mixer?.stream.getAudioTracks() ?? []) stream.addTrack(track);
    return stream;
  }

  async start(sink: MediaPipelineSink): Promise<void> {
    assertBrowserSupport('websocket');
    const { video } = this.settings;
    try {
      const selectedVideo = await selectVideoCodec(video);
      if (!selectedVideo) {
        throw new RelayError(
          RelayErrorCode.CodecUnsupported,
          'No hay codificador de video compatible (H.264 o VP8) para esta configuración.',
        );
      }
      this.videoEncoder = new WebCodecsVideoEncoder(selectedVideo, sink);
      this.clock.start();
      await this.startAudio(sink);

      const videoEncoder = this.videoEncoder;
      this.compositor = new CanvasCompositor(
        {
          ...this.videoSources(),
          width: video.width,
          height: video.height,
          framerate: video.framerate,
          clock: this.clock,
          placeholder: this.placeholder,
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

  async setSources(sources: PipelineSources): Promise<void> {
    this.sources = sources;
    this.mixer?.setInputs(this.audioInputs());
    await this.compositor?.setSources(this.videoSources());
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
  }

  private videoSources(): { screen?: MediaStreamTrack; camera?: MediaStreamTrack } {
    const { screen, camera } = this.sources;
    return {
      ...(screen ? { screen: screen as MediaStreamTrack } : {}),
      ...(camera ? { camera: camera as MediaStreamTrack } : {}),
    };
  }

  private audioInputs(): MixerInput[] {
    const inputs: MixerInput[] = [];
    if (this.sources.microphone) {
      inputs.push({ id: 'microphone', track: this.sources.microphone as MediaStreamTrack });
    }
    if (this.sources.screenAudio) {
      inputs.push({ id: 'screenAudio', track: this.sources.screenAudio as MediaStreamTrack });
    }
    return inputs;
  }

  private async startAudio(sink: MediaPipelineSink): Promise<void> {
    const { audio } = this.settings;
    let timeline: AudioTimeline | undefined;
    this.mixer = await WebAudioMixer.create(
      this.audioInputs(),
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
