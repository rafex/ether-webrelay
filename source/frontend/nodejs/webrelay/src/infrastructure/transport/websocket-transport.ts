import type { TransportConnection, TransportHandlers, TransportPort } from '../../ports/transport';

export const SUBPROTOCOL = 'ether-webrelay.v1';

type WebSocketCtor = new (url: string, protocols?: string | string[]) => WebSocket;

/**
 * TransportPort over the platform WebSocket (browsers, and Node ≥ 22 for tests).
 * Binary frames go out as ArrayBuffers; bridge messages arrive as text.
 */
export class WebSocketTransport implements TransportPort {
  constructor(
    private readonly WebSocketImpl: WebSocketCtor = globalThis.WebSocket,
    private readonly connectTimeoutMs = 10_000,
  ) {}

  connect(url: string, handlers: TransportHandlers): Promise<TransportConnection> {
    return new Promise((resolve, reject) => {
      const socket = new this.WebSocketImpl(url, SUBPROTOCOL);
      socket.binaryType = 'arraybuffer';
      let opened = false;

      const timeout = setTimeout(() => {
        if (opened) return;
        socket.close();
        reject(new Error(`WebSocket connect timeout after ${this.connectTimeoutMs} ms`));
      }, this.connectTimeoutMs);

      socket.addEventListener('open', () => {
        opened = true;
        clearTimeout(timeout);
        resolve(new WebSocketConnection(socket));
      });
      socket.addEventListener('message', (event: MessageEvent) => {
        if (typeof event.data === 'string') handlers.onText(event.data);
      });
      socket.addEventListener('close', (event: CloseEvent) => {
        clearTimeout(timeout);
        if (!opened) {
          reject(new Error(`WebSocket closed before opening (code ${event.code})`));
          return;
        }
        handlers.onClose({ code: event.code, reason: event.reason, wasClean: event.wasClean });
      });
      // 'error' is always followed by 'close', which carries the useful information.
      socket.addEventListener('error', () => undefined);
    });
  }
}

class WebSocketConnection implements TransportConnection {
  constructor(private readonly socket: WebSocket) {}

  get bufferedAmount(): number {
    return this.socket.bufferedAmount;
  }

  send(data: ArrayBuffer): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(data);
  }

  close(code = 1000, reason = ''): void {
    if (
      this.socket.readyState === this.socket.CLOSING ||
      this.socket.readyState === this.socket.CLOSED
    ) {
      return;
    }
    // Browsers only accept 1000 or 3000–4999 from applications.
    const safeCode = code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000;
    this.socket.close(safeCode, reason.slice(0, 123));
  }
}
