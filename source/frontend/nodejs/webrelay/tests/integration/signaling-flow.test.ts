import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type WebSocket, WebSocketServer } from 'ws';
import type { ServerMessage } from '../../src/domain/signaling';
import { WebSocketSignaling } from '../../src/infrastructure/signaling/websocket-signaling';

/** The signaling adapter over a real socket: subprotocol, JSON framing, tolerance. */
describe('WebSocketSignaling', () => {
  let server: WebSocketServer;
  let url: string;
  let peer: Promise<WebSocket>;

  beforeEach(async () => {
    server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/signal`;
    peer = new Promise((resolve) => server.once('connection', resolve));
  });

  afterEach(async () => {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('negotiates the v2 subprotocol and exchanges JSON messages', async () => {
    const received: ServerMessage[] = [];
    const connection = await new WebSocketSignaling().connect(url, {
      onMessage: (message) => received.push(message),
      onClose: () => undefined,
    });
    const socket = await peer;
    expect(socket.protocol).toBe('ether-webrelay.signaling.v2');

    const fromClient = new Promise<unknown>((resolve) =>
      socket.once('message', (data) => resolve(JSON.parse(String(data)))),
    );
    connection.send({ type: 'room.peek', room: 'demo', token: 't' });
    expect(await fromClient).toEqual({ type: 'room.peek', room: 'demo', token: 't' });

    socket.send('not json');
    socket.send(JSON.stringify({ type: 'from-the-future' }));
    socket.send(JSON.stringify({ type: 'pong', t: 7 }));
    await waitFor(() => received.length === 1);
    expect(received).toEqual([{ type: 'pong', t: 7 }]);
  });

  it('reports the close code and reason', async () => {
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      void new WebSocketSignaling().connect(url, { onMessage: () => undefined, onClose: resolve });
    });
    (await peer).close(4404, 'room closed');
    expect(await closed).toMatchObject({ code: 4404, reason: 'room closed' });
  });

  it('rejects when the bridge is unreachable', async () => {
    await expect(
      new WebSocketSignaling().connect('ws://127.0.0.1:1/signal', {
        onMessage: () => undefined,
        onClose: () => undefined,
      }),
    ).rejects.toThrow();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
