import type { ClientMessage, ServerMessage } from '../domain/signaling';
import type { CloseInfo } from './transport';

export interface SignalingHandlers {
  onMessage(message: ServerMessage): void;
  onClose(info: CloseInfo): void;
}

export interface SignalingConnection {
  send(message: ClientMessage): void;
  close(code?: number, reason?: string): void;
}

/** Driven port: JSON signaling channel to the bridge (docs/signaling.md). */
export interface SignalingPort {
  /** Resolves once open; rejects if the bridge cannot be reached. */
  connect(url: string, handlers: SignalingHandlers): Promise<SignalingConnection>;
}
