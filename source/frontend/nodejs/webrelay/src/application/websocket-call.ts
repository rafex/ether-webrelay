import { type CallStats, EMPTY_STATS } from '../domain/call-stats';
import type { RelayError } from '../domain/errors';
import type { TimeSource } from '../domain/media-clock';
import type { QualityProfile } from '../domain/quality-profile';
import { EMPTY_ROOM } from '../domain/room';
import type { SelfState } from '../domain/signaling';
import type { ComposableMediaPipelinePort, PipelineSources } from '../ports/media-pipeline';
import type { Timer, TimerHandle } from '../ports/time';
import type { BridgeLinkOptions } from './bridge-link';
import type {
  CallController,
  CallSnapshot,
  CallState,
  LocalMediaProvider,
  LocalTrackHandle,
} from './call-controller';
import { RelaySession, type SessionState } from './relay-session';

type Slot = keyof PipelineSources;

export interface WebSocketCallDeps {
  readonly link: BridgeLinkOptions;
  readonly media: LocalMediaProvider;
  readonly createPipeline: (sources: PipelineSources) => ComposableMediaPipelinePort;
  readonly initial: { readonly camera?: LocalTrackHandle; readonly microphone?: LocalTrackHandle };
  readonly microphoneEnabled: boolean;
  readonly profile: QualityProfile;
  readonly timer: Timer;
  readonly time: TimeSource;
  readonly statsIntervalMs?: number;
}

const STATE_MAP: Record<SessionState, CallState> = {
  idle: 'joining',
  starting: 'joining',
  live: 'connected',
  reconnecting: 'reconnecting',
  stopping: 'left',
  stopped: 'left',
  failed: 'failed',
};

/**
 * Alternative "sender only" transport: the participant's composite (screen +
 * camera picture-in-picture, mixed audio) is encoded with WebCodecs and sent
 * over the binary WebSocket protocol v1. Other participants are not received.
 */
export class WebSocketCallSession implements CallController {
  private readonly local: Partial<Record<Slot, LocalTrackHandle>> = {};
  private readonly pipeline: ComposableMediaPipelinePort;
  private readonly session: RelaySession;
  private state: CallState = 'joining';
  private self: SelfState;
  private stats: CallStats | undefined;
  private statsTimer: TimerHandle | undefined;
  private error: RelayError | undefined;
  private readonly listeners = new Set<(snapshot: CallSnapshot) => void>();

  constructor(private readonly deps: WebSocketCallDeps) {
    if (deps.initial.camera) this.local.camera = deps.initial.camera;
    if (deps.initial.microphone) {
      this.local.microphone = deps.initial.microphone;
      deps.initial.microphone.track.enabled = deps.microphoneEnabled;
    }
    this.self = {
      muted: !deps.microphoneEnabled || !deps.initial.microphone,
      cameraOff: !deps.initial.camera,
      screenSharing: false,
    };
    this.pipeline = deps.createPipeline(this.sources());
    this.session = new RelaySession(
      { pipeline: this.pipeline, link: deps.link },
      {
        onStateChange: (state) => this.setState(STATE_MAP[state]),
        onError: (error) => {
          this.error = error;
          this.releaseLocal();
          this.setState('failed');
        },
      },
    );
  }

  get snapshot(): CallSnapshot {
    return {
      mode: 'websocket',
      state: this.state,
      self: this.self,
      local: {
        ...(this.local.camera ? { camera: this.local.camera.track } : {}),
        ...(this.local.microphone ? { microphone: this.local.microphone.track } : {}),
        ...(this.local.screen ? { screen: this.local.screen.track } : {}),
      },
      room: EMPTY_ROOM,
      remote: new Map(),
      stats: this.stats,
      profile: this.deps.profile,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  subscribe(listener: (snapshot: CallSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async join(): Promise<void> {
    const ready = new Promise<void>((resolve, reject) => {
      const unsubscribe = this.subscribe((snapshot) => {
        if (snapshot.state === 'connected') {
          unsubscribe();
          resolve();
        } else if (snapshot.state === 'failed') {
          unsubscribe();
          reject(snapshot.error);
        }
      });
    });
    await this.session.start();
    this.statsTimer = this.deps.timer.setInterval(
      () => this.sampleStats(),
      this.deps.statsIntervalMs ?? 2_000,
    );
    await ready;
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (enabled && !this.local.microphone) {
      await this.put('microphone', await this.deps.media.openMicrophone());
    }
    if (this.local.microphone) this.local.microphone.track.enabled = enabled;
    this.self = { ...this.self, muted: !enabled };
    this.emit();
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (enabled && !this.local.camera) await this.put('camera', await this.deps.media.openCamera());
    if (!enabled) await this.put('camera', undefined);
    this.self = { ...this.self, cameraOff: !enabled };
    this.emit();
  }

  async startScreenShare(): Promise<void> {
    if (this.self.screenSharing) return;
    const capture = await this.deps.media.openScreen({
      framerate: this.deps.profile.screenFramerate,
      withAudio: true,
    });
    capture.video.track.addEventListener('ended', () => void this.stopScreenShare());
    this.replaceLocal('screen', capture.video);
    if (capture.audio) this.replaceLocal('screenAudio', capture.audio);
    await this.pipeline.setSources(this.sources());
    this.self = { ...this.self, screenSharing: true };
    this.emit();
  }

  async stopScreenShare(): Promise<void> {
    if (!this.self.screenSharing) return;
    this.replaceLocal('screen', undefined);
    this.replaceLocal('screenAudio', undefined);
    await this.pipeline.setSources(this.sources());
    this.self = { ...this.self, screenSharing: false };
    this.emit();
  }

  async replaceCamera(handle: LocalTrackHandle): Promise<void> {
    if (this.self.cameraOff) {
      handle.stop();
      return;
    }
    await this.put('camera', handle);
  }

  async replaceMicrophone(handle: LocalTrackHandle): Promise<void> {
    handle.track.enabled = !this.self.muted;
    await this.put('microphone', handle);
  }

  async leave(): Promise<void> {
    if (this.state === 'left' || this.state === 'failed') return;
    await this.session.stop();
    this.releaseLocal();
    this.setState('left');
  }

  // -------------------------------------------------------------------------

  private async put(slot: Slot, handle: LocalTrackHandle | undefined): Promise<void> {
    this.replaceLocal(slot, handle);
    await this.pipeline.setSources(this.sources());
    this.emit();
  }

  private replaceLocal(slot: Slot, handle: LocalTrackHandle | undefined): void {
    const previous = this.local[slot];
    if (handle) this.local[slot] = handle;
    else delete this.local[slot];
    if (previous && previous !== handle) previous.stop();
  }

  private sources(): PipelineSources {
    const sources: Record<string, unknown> = {};
    for (const slot of Object.keys(this.local) as Slot[]) {
      const handle = this.local[slot];
      if (handle) sources[slot] = handle.track;
    }
    return sources as PipelineSources;
  }

  private sampleStats(): void {
    const relay = this.session.stats;
    const now = this.deps.time.nowMs();
    const previous = this.stats ?? EMPTY_STATS;
    const elapsed = previous.atMs > 0 ? (now - previous.atMs) / 1000 : 0;
    this.stats = {
      ...EMPTY_STATS,
      atMs: now,
      bytesSent: relay.bytesSent,
      uploadBps:
        elapsed > 0 ? Math.round(((relay.bytesSent - previous.bytesSent) * 8) / elapsed) : 0,
      rttMs: relay.rttMs === undefined ? undefined : Math.round(relay.rttMs),
    };
    this.emit();
  }

  private releaseLocal(): void {
    if (this.statsTimer !== undefined) this.deps.timer.clearInterval(this.statsTimer);
    this.statsTimer = undefined;
    for (const slot of Object.keys(this.local) as Slot[]) this.replaceLocal(slot, undefined);
  }

  private setState(state: CallState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit();
  }

  private emit(): void {
    const snapshot = this.snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}
