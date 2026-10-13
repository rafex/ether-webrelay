import {
  type ClientMessage,
  parseServerMessage,
  SIGNALING_SUBPROTOCOL,
  serializeClientMessage,
} from '../../domain/signaling';
import type { SignalingConnection, SignalingHandlers, SignalingPort } from '../../ports/signaling';
import { safeCloseCode, safeCloseReason } from '../transport/websocket-transport';

type WebSocketCtor = new (url: string, protocols?: string | string[]) => WebSocket;

/**
 * SignalingPort over the platform WebSocket (browsers, Node ≥ 22 in tests).
 * Malformed or unknown messages are dropped: newer bridges may send more.
 */
export class WebSocketSignaling implements SignalingPort {
  constructor(
    private readonly WebSocketImpl: WebSocketCtor = globalThis.WebSocket,
    private readonly connectTimeoutMs = 10_000,
  ) {}

  connect(url: string, handlers: SignalingHandlers): Promise<SignalingConnection> {
    return new Promise((resolve, reject) => {
      const socket = new this.WebSocketImpl(url, SIGNALING_SUBPROTOCOL);
      let opened = false;
      const timeout = setTimeout(() => {
        if (opened) return;
        socket.close();
        reject(new Error(`signaling connect timeout after ${this.connectTimeoutMs} ms`));
      }, this.connectTimeoutMs);

      socket.addEventListener('open', () => {
        opened = true;
        clearTimeout(timeout);
        resolve({
          send(message: ClientMessage) {
            if (socket.readyState === socket.OPEN) socket.send(serializeClientMessage(message));
          },
          close(code = 1000, reason = '') {
            if (socket.readyState === socket.CLOSING || socket.readyState === socket.CLOSED) return;
            socket.close(safeCloseCode(code), safeCloseReason(reason));
          },
        });
      });
      socket.addEventListener('message', (event: MessageEvent) => {
        if (typeof event.data !== 'string') return;
        try {
          handlers.onMessage(parseServerMessage(event.data));
        } catch {
          // Ignored for forward compatibility.
        }
      });
      socket.addEventListener('close', (event: CloseEvent) => {
        clearTimeout(timeout);
        if (!opened) {
          reject(new Error(`signaling closed before opening (code ${event.code})`));
          return;
        }
        handlers.onClose({ code: event.code, reason: event.reason, wasClean: event.wasClean });
      });
      socket.addEventListener('error', () => undefined);
    });
  }
}
