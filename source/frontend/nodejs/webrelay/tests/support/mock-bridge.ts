import type { AddressInfo } from 'node:net';
import { type WebSocket, WebSocketServer } from 'ws';
import {
  decodeFrame,
  decodeJsonPayload,
  type Frame,
  FrameType,
  type HelloPayload,
} from '../../src/domain/protocol';

export interface BridgeConnection {
  readonly socket: WebSocket;
  readonly frames: Frame[];
  readonly protocol: string;
  hello: HelloPayload | undefined;
}

export interface MockBridgeOptions {
  /** Reject HELLOs whose token differs (fatal error, like a real auth failure). */
  readonly token?: string;
}

/**
 * Minimal in-process stand-in for the real bridge, used only by tests:
 * decodes frames, answers HELLO with `welcome` and PING with `pong`.
 * It does not publish RTMPS — the bridge is out of this repository's scope.
 */
export class MockBridge {
  readonly connections: BridgeConnection[] = [];
  private readonly server: WebSocketServer;
  private readonly seenStreams = new Set<string>();
  private readonly waiters: (() => void)[] = [];

  private constructor(
    server: WebSocketServer,
    private readonly options: MockBridgeOptions,
  ) {
    this.server = server;
    server.on('connection', (socket) => this.accept(socket));
  }

  static async start(options: MockBridgeOptions = {}): Promise<MockBridge> {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    return new MockBridge(server, options);
  }

  get url(): string {
    const { port } = this.server.address() as AddressInfo;
    return `ws://127.0.0.1:${port}/relay`;
  }

  get last(): BridgeConnection {
    const connection = this.connections.at(-1);
    if (!connection) throw new Error('no connection yet');
    return connection;
  }

  /** Resolves once `predicate` holds, re-checking after every received frame. */
  async until(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('MockBridge.until timed out');
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 20);
      });
    }
  }

  /** Abruptly drops every live connection (network failure). */
  dropAll(): void {
    for (const connection of this.connections) connection.socket.terminate();
  }

  async close(): Promise<void> {
    for (const client of this.server.clients) client.terminate();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private accept(socket: WebSocket): void {
    const connection: BridgeConnection = {
      socket,
      frames: [],
      protocol: socket.protocol,
      hello: undefined,
    };
    this.connections.push(connection);
    socket.on('message', (data, isBinary) => {
      if (!isBinary) return;
      const frame = decodeFrame(data as Buffer);
      connection.frames.push(frame);
      this.handle(connection, frame);
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  private handle(connection: BridgeConnection, frame: Frame): void {
    const send = (message: object) => connection.socket.send(JSON.stringify(message));
    switch (frame.type) {
      case FrameType.Hello: {
        const hello = decodeJsonPayload<HelloPayload>(frame.payload);
        connection.hello = hello;
        if (this.options.token !== undefined && hello.token !== this.options.token) {
          send({ type: 'error', code: 'unauthorized', message: 'invalid token', fatal: true });
          connection.socket.close(4401, 'unauthorized');
          return;
        }
        const resumed = hello.resume && this.seenStreams.has(hello.streamId);
        this.seenStreams.add(hello.streamId);
        send({ type: 'welcome', streamId: hello.streamId, resumed });
        break;
      }
      case FrameType.Ping:
        send({ type: 'pong', timestampUs: frame.timestampUs });
        break;
      default:
        break;
    }
  }
}
