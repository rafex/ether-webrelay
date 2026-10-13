import { RelayError, RelayErrorCode } from '../domain/errors';
import type { TimeSource } from '../domain/media-clock';
import type { ReconnectPolicy } from '../domain/reconnect-policy';
import type { ClientMessage, ServerMessage } from '../domain/signaling';
import type { SignalingConnection, SignalingPort } from '../ports/signaling';
import type { Timer, TimerHandle } from '../ports/time';

export type SignalingState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'failed';

export interface SignalingClientOptions {
  readonly url: string;
  readonly signaling: SignalingPort;
  readonly reconnectPolicy: ReconnectPolicy;
  readonly timer: Timer;
  readonly time: TimeSource;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatMisses?: number;
}

type Listener<T> = (value: T) => void;

/**
 * Owns the signaling WebSocket shared by the lobby and the call: connects,
 * reconnects with backoff, keeps a heartbeat and fans messages out to
 * subscribers. Consumers re-send their state (peek/join) on `onReconnected`.
 */
export class SignalingClient {
  private state: SignalingState = 'idle';
  private connection: SignalingConnection | undefined;
  private attempt = 0;
  private everOpened = false;
  private lastSeenMs = 0;
  private heartbeat: TimerHandle | undefined;
  private reconnectTimer: TimerHandle | undefined;
  private firstOpen: { resolve: () => void; reject: (error: Error) => void } | undefined;
  private readonly messageListeners = new Set<Listener<ServerMessage>>();
  private readonly stateListeners = new Set<Listener<SignalingState>>();
  private readonly reconnectedListeners = new Set<() => void>();
  private readonly failedListeners = new Set<Listener<RelayError>>();
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatMisses: number;

  constructor(private readonly options: SignalingClientOptions) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5_000;
    this.heartbeatMisses = options.heartbeatMisses ?? 3;
  }

  get currentState(): SignalingState {
    return this.state;
  }

  /** Resolves on the first successful connection; rejects if attempts are exhausted. */
  open(): Promise<void> {
    if (this.state !== 'idle') throw new Error(`SignalingClient.open() in state ${this.state}`);
    const opened = new Promise<void>((resolve, reject) => {
      this.firstOpen = { resolve, reject };
    });
    void this.connect();
    return opened;
  }

  send(message: ClientMessage): boolean {
    if (this.state !== 'open' || !this.connection) return false;
    this.connection.send(message);
    return true;
  }

  onMessage(listener: Listener<ServerMessage>): () => void {
    return subscribe(this.messageListeners, listener);
  }

  onStateChange(listener: Listener<SignalingState>): () => void {
    return subscribe(this.stateListeners, listener);
  }

  /** Fired when the socket comes back after a drop (not on the first open). */
  onReconnected(listener: () => void): () => void {
    return subscribe(this.reconnectedListeners, listener);
  }

  onFailed(listener: Listener<RelayError>): () => void {
    return subscribe(this.failedListeners, listener);
  }

  /** Closes for good (no reconnection). */
  close(reason = 'client-close'): void {
    if (this.state === 'closed' || this.state === 'failed') return;
    const connection = this.connection;
    this.teardown();
    connection?.close(1000, reason);
    this.setState('closed');
  }

  /** Stops reconnecting and reports a fatal error (e.g. the bridge rejected the token). */
  fail(error: RelayError): void {
    if (this.state === 'closed' || this.state === 'failed') return;
    const connection = this.connection;
    this.teardown();
    connection?.close(1000, error.code);
    this.setState('failed');
    this.firstOpen?.reject(error);
    this.firstOpen = undefined;
    for (const listener of this.failedListeners) listener(error);
  }

  // -------------------------------------------------------------------------

  private async connect(): Promise<void> {
    const attempt = ++this.attempt;
    this.setState(this.everOpened ? 'reconnecting' : 'connecting');
    let connection: SignalingConnection;
    try {
      connection = await this.options.signaling.connect(this.options.url, {
        onMessage: (message) => this.handleMessage(attempt, message),
        onClose: () => this.handleClose(attempt),
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
    const reconnected = this.everOpened;
    this.everOpened = true;
    this.options.reconnectPolicy.reset();
    this.setState('open');
    this.heartbeat = this.options.timer.setInterval(() => this.beat(), this.heartbeatIntervalMs);
    this.firstOpen?.resolve();
    this.firstOpen = undefined;
    if (reconnected) for (const listener of this.reconnectedListeners) listener();
  }

  private handleMessage(attempt: number, message: ServerMessage): void {
    if (attempt !== this.attempt || this.isFinal()) return;
    this.lastSeenMs = this.options.time.nowMs();
    if (message.type === 'error' && message.fatal) {
      this.fail(
        new RelayError(
          RelayErrorCode.BridgeRejected,
          describeBridgeError(message.code, message.message),
        ),
      );
      return;
    }
    for (const listener of this.messageListeners) listener(message);
  }

  private handleClose(attempt: number): void {
    if (attempt !== this.attempt || this.isFinal()) return;
    this.dropConnection();
    this.scheduleReconnect();
  }

  private beat(): void {
    if (this.state !== 'open' || !this.connection) return;
    const now = this.options.time.nowMs();
    if (now - this.lastSeenMs > this.heartbeatIntervalMs * this.heartbeatMisses) {
      const connection = this.connection;
      this.attempt++; // late events from the dead socket are now stale
      this.dropConnection();
      connection.close(4000, 'heartbeat-timeout');
      this.scheduleReconnect();
      return;
    }
    this.connection.send({ type: 'ping', t: Math.round(now) });
  }

  private scheduleReconnect(): void {
    const delay = this.options.reconnectPolicy.nextDelayMs();
    if (delay === null) {
      this.fail(
        new RelayError(
          RelayErrorCode.ReconnectExhausted,
          'No se pudo conectar con el servidor de la sala. Revisa tu conexión e inténtalo de nuevo.',
        ),
      );
      return;
    }
    this.setState(this.everOpened ? 'reconnecting' : 'connecting');
    this.reconnectTimer = this.options.timer.setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
  }

  private dropConnection(): void {
    this.connection = undefined;
    if (this.heartbeat !== undefined) this.options.timer.clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  private teardown(): void {
    this.attempt++;
    this.dropConnection();
    if (this.reconnectTimer !== undefined) this.options.timer.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private isFinal(): boolean {
    return this.state === 'closed' || this.state === 'failed';
  }

  private setState(state: SignalingState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.stateListeners) listener(state);
  }
}

const BRIDGE_ERRORS: Record<string, string> = {
  'invalid-token': 'El enlace de invitación no es válido o ha caducado.',
  'room-not-found': 'La sala no existe o ya terminó.',
  'room-closed': 'La sala se ha cerrado.',
  'room-full': 'La sala está llena.',
  kicked: 'El anfitrión te ha retirado de la sala.',
};

export function describeBridgeError(code: string, message: string): string {
  return BRIDGE_ERRORS[code] ?? (message || `El servidor rechazó la conexión (${code}).`);
}

function subscribe<T>(set: Set<T>, listener: T): () => void {
  set.add(listener);
  return () => set.delete(listener);
}
