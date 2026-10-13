import { RelayError, RelayErrorCode } from '../domain/errors';
import type { TimeSource } from '../domain/media-clock';
import {
  type BridgeMessage,
  encodeFrame,
  encodeJsonPayload,
  FrameType,
  type HelloPayload,
  nextSequence,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  parseBridgeMessage,
  type TrackConfig,
  TrackId,
  trackIdOf,
} from '../domain/protocol';
import type { ReconnectPolicy } from '../domain/reconnect-policy';
import type { Timer, TimerHandle } from '../ports/time';
import type { CloseInfo, TransportConnection, TransportPort } from '../ports/transport';

export type LinkState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'failed';

export interface ReadyInfo {
  /** The bridge kept the RTMPS session alive across the reconnection. */
  readonly resumed: boolean;
  /** This is not the first successful connection. */
  readonly reconnect: boolean;
}

export interface BridgeLinkEvents {
  onReady(info: ReadyInfo): void;
  onStateChange(state: LinkState): void;
  onKeyframeRequest(): void;
  onFailed(error: RelayError): void;
  onBridgeMessage?(message: BridgeMessage): void;
  onRtt?(rttMs: number): void;
}

export type HelloIdentity = Omit<HelloPayload, 'protocol' | 'version' | 'resume'>;

export interface BridgeLinkOptions {
  readonly url: string;
  readonly hello: HelloIdentity;
  readonly transport: TransportPort;
  readonly reconnectPolicy: ReconnectPolicy;
  readonly timer: Timer;
  readonly time: TimeSource;
  readonly handshakeTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  /** Consecutive silent heartbeat intervals before the connection is presumed dead. */
  readonly heartbeatMisses?: number;
}

/**
 * Owns the WebSocket to the bridge: handshake, heartbeat, framing and
 * automatic reconnection with stream resumption. Sequence numbers keep
 * increasing across reconnections so the bridge can detect gaps.
 */
export class BridgeLink {
  private state: LinkState = 'idle';
  private connection: TransportConnection | undefined;
  private attempt = 0;
  private everConnected = false;
  private sequence = 0;
  private lastSeenMs = 0;
  private handshakeTimer: TimerHandle | undefined;
  private heartbeatTimer: TimerHandle | undefined;
  private reconnectTimer: TimerHandle | undefined;
  private readonly handshakeTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatMisses: number;

  constructor(
    private readonly options: BridgeLinkOptions,
    private readonly events: BridgeLinkEvents,
  ) {
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5_000;
    this.heartbeatMisses = options.heartbeatMisses ?? 3;
  }

  get currentState(): LinkState {
    return this.state;
  }

  get isOpen(): boolean {
    return this.state === 'open';
  }

  get bufferedAmount(): number {
    return this.connection?.bufferedAmount ?? 0;
  }

  open(): void {
    if (this.state !== 'idle') throw new Error(`BridgeLink.open() in state ${this.state}`);
    void this.connect();
  }

  sendConfig(config: TrackConfig): boolean {
    return this.sendWhenOpen(
      FrameType.Config,
      trackIdOf(config.track),
      0,
      0,
      0,
      encodeJsonPayload(config),
    );
  }

  sendMedia(
    track: 'video' | 'audio',
    flags: number,
    timestampUs: number,
    durationUs: number,
    data: Uint8Array,
  ): boolean {
    return this.sendWhenOpen(
      FrameType.Media,
      trackIdOf(track),
      flags,
      timestampUs,
      durationUs,
      data,
    );
  }

  /** Graceful shutdown: says goodbye and stops reconnecting. */
  close(reason = 'client-stop'): void {
    if (this.state === 'closed' || this.state === 'failed') return;
    const connection = this.connection;
    if (connection && this.state === 'open') {
      this.write(
        connection,
        FrameType.Bye,
        TrackId.Control,
        0,
        0,
        0,
        encodeJsonPayload({ reason }),
      );
    }
    this.teardown();
    connection?.close(1000, reason);
    this.setState('closed');
  }

  // -------------------------------------------------------------------------

  private async connect(): Promise<void> {
    const attempt = ++this.attempt;
    this.setState(this.everConnected ? 'reconnecting' : 'connecting');
    let connection: TransportConnection;
    try {
      connection = await this.options.transport.connect(this.options.url, {
        onText: (text) => this.handleText(attempt, text),
        onClose: (info) => this.handleClose(attempt, info),
      });
    } catch {
      if (attempt === this.attempt && !this.isFinal()) this.scheduleReconnect();
      return;
    }
    if (attempt !== this.attempt || this.isFinal()) {
      connection.close(1000, 'superseded');
      return;
    }
    this.connection = connection;
    this.lastSeenMs = this.options.time.nowMs();
    const hello: HelloPayload = {
      ...this.options.hello,
      protocol: PROTOCOL_NAME,
      version: PROTOCOL_VERSION,
      resume: this.everConnected,
    };
    this.write(connection, FrameType.Hello, TrackId.Control, 0, 0, 0, encodeJsonPayload(hello));
    this.handshakeTimer = this.options.timer.setTimeout(
      () => this.abandon(attempt, 'handshake-timeout'),
      this.handshakeTimeoutMs,
    );
  }

  private handleText(attempt: number, text: string): void {
    if (attempt !== this.attempt || this.isFinal()) return;
    this.lastSeenMs = this.options.time.nowMs();
    let message: BridgeMessage;
    try {
      message = parseBridgeMessage(text);
    } catch {
      return; // Unknown or malformed messages are ignored for forward compatibility.
    }
    this.events.onBridgeMessage?.(message);
    switch (message.type) {
      case 'welcome':
        this.onWelcome(message.resumed);
        break;
      case 'keyframe-request':
        this.events.onKeyframeRequest();
        break;
      case 'pong':
        this.events.onRtt?.(Math.max(0, this.nowUs() - message.timestampUs) / 1000);
        break;
      case 'error':
        if (message.fatal) {
          this.fail(
            new RelayError(RelayErrorCode.BridgeRejected, `${message.code}: ${message.message}`),
          );
        }
        break;
      default:
        break;
    }
  }

  private onWelcome(resumed: boolean): void {
    if (this.state === 'open') return;
    this.clear('handshakeTimer');
    const reconnect = this.everConnected;
    this.everConnected = true;
    this.options.reconnectPolicy.reset();
    this.setState('open');
    this.heartbeatTimer = this.options.timer.setInterval(
      () => this.heartbeat(),
      this.heartbeatIntervalMs,
    );
    this.events.onReady({ resumed, reconnect });
  }

  private heartbeat(): void {
    const connection = this.connection;
    if (!connection || this.state !== 'open') return;
    const silentMs = this.options.time.nowMs() - this.lastSeenMs;
    if (silentMs > this.heartbeatIntervalMs * this.heartbeatMisses) {
      this.abandon(this.attempt, 'heartbeat-timeout');
      return;
    }
    this.write(connection, FrameType.Ping, TrackId.Control, 0, this.nowUs(), 0, new Uint8Array());
  }

  private handleClose(attempt: number, _info: CloseInfo): void {
    if (attempt !== this.attempt || this.isFinal()) return;
    this.connection = undefined;
    this.clear('handshakeTimer');
    this.clear('heartbeatTimer');
    this.scheduleReconnect();
  }

  /** Drops a connection that is alive at the TCP level but useless (no handshake, no heartbeat). */
  private abandon(attempt: number, reason: string): void {
    if (attempt !== this.attempt || this.isFinal()) return;
    const connection = this.connection;
    this.attempt++; // late events from this connection are now stale
    this.connection = undefined;
    this.clear('handshakeTimer');
    this.clear('heartbeatTimer');
    connection?.close(4000, reason);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const delay = this.options.reconnectPolicy.nextDelayMs();
    if (delay === null) {
      this.fail(
        new RelayError(
          RelayErrorCode.ReconnectExhausted,
          `bridge unreachable after ${this.options.reconnectPolicy.attempts} attempts`,
        ),
      );
      return;
    }
    this.setState('reconnecting');
    this.reconnectTimer = this.options.timer.setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
  }

  private fail(error: RelayError): void {
    if (this.isFinal()) return;
    const connection = this.connection;
    this.teardown();
    connection?.close(1000, error.code);
    this.setState('failed');
    this.events.onFailed(error);
  }

  private teardown(): void {
    this.attempt++;
    this.connection = undefined;
    this.clear('handshakeTimer');
    this.clear('heartbeatTimer');
    this.clear('reconnectTimer');
  }

  private sendWhenOpen(
    type: FrameType,
    track: TrackId,
    flags: number,
    timestampUs: number,
    durationUs: number,
    payload: Uint8Array,
  ): boolean {
    if (this.state !== 'open' || !this.connection) return false;
    this.write(this.connection, type, track, flags, timestampUs, durationUs, payload);
    return true;
  }

  private write(
    connection: TransportConnection,
    type: FrameType,
    track: TrackId,
    flags: number,
    timestampUs: number,
    durationUs: number,
    payload: Uint8Array,
  ): void {
    const sequence = this.sequence;
    this.sequence = nextSequence(sequence);
    connection.send(
      encodeFrame({ type, track, flags, sequence, timestampUs, durationUs, payload }),
    );
  }

  private clear(name: 'handshakeTimer' | 'heartbeatTimer' | 'reconnectTimer'): void {
    const handle = this[name];
    if (handle === undefined) return;
    if (name === 'heartbeatTimer') this.options.timer.clearInterval(handle);
    else this.options.timer.clearTimeout(handle);
    this[name] = undefined;
  }

  private isFinal(): boolean {
    return this.state === 'closed' || this.state === 'failed';
  }

  private nowUs(): number {
    return Math.round(this.options.time.nowMs() * 1000);
  }

  private setState(state: LinkState): void {
    if (this.state === state) return;
    this.state = state;
    this.events.onStateChange(state);
  }
}
