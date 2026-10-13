import { BackpressureGate } from '../domain/backpressure';
import { RelayError, RelayErrorCode } from '../domain/errors';
import { FrameFlag, type TrackConfig } from '../domain/protocol';
import type { EncodedChunk, MediaPipelinePort, MediaPipelineSink } from '../ports/media-pipeline';
import { BridgeLink, type BridgeLinkOptions, type LinkState, type ReadyInfo } from './bridge-link';

export type SessionState =
  | 'idle'
  | 'starting'
  | 'live'
  | 'reconnecting'
  | 'stopping'
  | 'stopped'
  | 'failed';

export interface RelayStats {
  readonly videoFramesSent: number;
  readonly audioFramesSent: number;
  readonly videoFramesDropped: number;
  readonly audioFramesDropped: number;
  readonly keyframesSent: number;
  readonly bytesSent: number;
  readonly reconnects: number;
  readonly rttMs: number | undefined;
  readonly bufferedBytes: number;
}

export interface RelaySessionEvents {
  onStateChange?(state: SessionState): void;
  onError?(error: RelayError): void;
  onReady?(info: ReadyInfo): void;
}

export interface RelaySessionDeps {
  readonly pipeline: MediaPipelinePort;
  readonly link: BridgeLinkOptions;
  readonly gate?: BackpressureGate;
}

type MutableStats = { -readonly [K in keyof RelayStats]: RelayStats[K] };

/**
 * Application service: wires the media pipeline to the bridge link.
 * It replays track configs and forces a keyframe after every (re)connection,
 * applies backpressure, and keeps delivery statistics.
 */
export class RelaySession {
  private state: SessionState = 'idle';
  private readonly link: BridgeLink;
  private readonly gate: BackpressureGate;
  private readonly configs = new Map<'video' | 'audio', TrackConfig>();
  private readonly counters: MutableStats = {
    videoFramesSent: 0,
    audioFramesSent: 0,
    videoFramesDropped: 0,
    audioFramesDropped: 0,
    keyframesSent: 0,
    bytesSent: 0,
    reconnects: 0,
    rttMs: undefined,
    bufferedBytes: 0,
  };

  constructor(
    private readonly deps: RelaySessionDeps,
    private readonly events: RelaySessionEvents = {},
  ) {
    this.gate = deps.gate ?? new BackpressureGate();
    this.link = new BridgeLink(deps.link, {
      onReady: (info) => this.handleReady(info),
      onStateChange: (state) => this.handleLinkState(state),
      onKeyframeRequest: () => this.deps.pipeline.requestKeyframe(),
      onFailed: (error) => void this.fail(error),
      onRtt: (rtt) => {
        this.counters.rttMs = rtt;
      },
    });
  }

  get currentState(): SessionState {
    return this.state;
  }

  get stats(): RelayStats {
    return { ...this.counters, bufferedBytes: this.link.bufferedAmount };
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') throw new Error(`RelaySession.start() in state ${this.state}`);
    this.setState('starting');
    this.link.open();
    const sink: MediaPipelineSink = {
      onConfig: (config) => this.handleConfig(config),
      onChunk: (chunk) => this.handleChunk(chunk),
      onError: (error) =>
        void this.fail(
          error instanceof RelayError
            ? error
            : new RelayError(RelayErrorCode.EncoderFailure, error.message, { cause: error }),
        ),
    };
    try {
      await this.deps.pipeline.start(sink);
    } catch (error) {
      const relayError =
        error instanceof RelayError
          ? error
          : new RelayError(RelayErrorCode.CaptureDenied, (error as Error).message, {
              cause: error,
            });
      await this.fail(relayError);
      throw relayError;
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'stopping' || this.state === 'failed') return;
    this.setState('stopping');
    await this.deps.pipeline.stop();
    this.link.close('client-stop');
    this.setState('stopped');
  }

  private handleConfig(config: TrackConfig): void {
    this.configs.set(config.track, config);
    this.link.sendConfig(config);
  }

  private handleChunk(chunk: EncodedChunk): void {
    if (!this.link.isOpen) {
      this.countDrop(chunk);
      return;
    }
    const decision = this.gate.decide(chunk, this.link.bufferedAmount);
    if (decision.requestKeyframe) this.deps.pipeline.requestKeyframe();
    if (!decision.send) {
      this.countDrop(chunk);
      return;
    }
    const flags =
      (chunk.keyframe ? FrameFlag.Keyframe : FrameFlag.None) |
      (decision.discontinuity ? FrameFlag.Discontinuity : FrameFlag.None);
    if (!this.link.sendMedia(chunk.track, flags, chunk.timestampUs, chunk.durationUs, chunk.data)) {
      this.countDrop(chunk);
      return;
    }
    this.counters.bytesSent += chunk.data.byteLength;
    if (chunk.track === 'video') {
      this.counters.videoFramesSent++;
      if (chunk.keyframe) this.counters.keyframesSent++;
    } else {
      this.counters.audioFramesSent++;
    }
  }

  private handleReady(info: ReadyInfo): void {
    if (info.reconnect) this.counters.reconnects++;
    for (const config of this.configs.values()) this.link.sendConfig(config);
    this.gate.reset();
    this.deps.pipeline.requestKeyframe();
    this.setState('live');
    this.events.onReady?.(info);
  }

  private handleLinkState(state: LinkState): void {
    if (state === 'reconnecting' && (this.state === 'live' || this.state === 'starting')) {
      this.setState('reconnecting');
    }
  }

  private countDrop(chunk: EncodedChunk): void {
    if (chunk.track === 'video') this.counters.videoFramesDropped++;
    else this.counters.audioFramesDropped++;
  }

  private async fail(error: RelayError): Promise<void> {
    if (this.state === 'failed' || this.state === 'stopped') return;
    this.setState('failed');
    this.link.close(error.code);
    await this.deps.pipeline.stop().catch(() => undefined);
    this.events.onError?.(error);
  }

  private setState(state: SessionState): void {
    if (this.state === state) return;
    this.state = state;
    this.events.onStateChange?.(state);
  }
}
