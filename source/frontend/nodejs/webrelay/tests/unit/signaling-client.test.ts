import { describe, expect, it } from 'vitest';
import { SignalingClient, type SignalingState } from '../../src/application/signaling-client';
import type { RelayError } from '../../src/domain/errors';
import { ReconnectPolicy } from '../../src/domain/reconnect-policy';
import type { ServerMessage } from '../../src/domain/signaling';
import { FakeSignaling } from '../support/call-fakes';
import { flushMicrotasks, ManualClock } from '../support/fakes';

function setup(maxAttempts = 3) {
  const clock = new ManualClock();
  const signaling = new FakeSignaling();
  const client = new SignalingClient({
    url: 'wss://bridge.test/signal',
    signaling,
    reconnectPolicy: new ReconnectPolicy(
      { initialDelayMs: 100, maxDelayMs: 400, multiplier: 2, jitterRatio: 0, maxAttempts },
      () => 0.5,
    ),
    timer: clock,
    time: clock,
    heartbeatIntervalMs: 1_000,
    heartbeatMisses: 3,
  });
  const states: SignalingState[] = [];
  const messages: ServerMessage[] = [];
  const failures: RelayError[] = [];
  let reconnections = 0;
  client.onStateChange((s) => states.push(s));
  client.onMessage((m) => messages.push(m));
  client.onFailed((e) => failures.push(e));
  client.onReconnected(() => reconnections++);
  return {
    clock,
    signaling,
    client,
    states,
    messages,
    failures,
    reconnections: () => reconnections,
  };
}

describe('SignalingClient', () => {
  it('opens, sends and fans messages out', async () => {
    const h = setup();
    await h.client.open();
    expect(h.client.currentState).toBe('open');
    expect(h.client.send({ type: 'room.peek', room: 'r', token: 't' })).toBe(true);
    expect(h.signaling.last.sent).toEqual([{ type: 'room.peek', room: 'r', token: 't' }]);
    h.signaling.last.receive({ type: 'pong', t: 1 });
    expect(h.messages).toEqual([{ type: 'pong', t: 1 }]);
    expect(() => h.client.open()).toThrow();
  });

  it('keeps retrying the first connection with backoff', async () => {
    const h = setup();
    h.signaling.failNext = 2;
    const opened = h.client.open();
    await flushMicrotasks();
    expect(h.client.currentState).toBe('connecting');
    await h.clock.advance(100);
    await h.clock.advance(200);
    await opened;
    expect(h.signaling.connections).toHaveLength(1);
    expect(h.reconnections()).toBe(0);
  });

  it('reconnects after a drop and announces it', async () => {
    const h = setup();
    await h.client.open();
    h.signaling.last.drop();
    expect(h.client.currentState).toBe('reconnecting');
    expect(h.client.send({ type: 'leave' })).toBe(false);
    await h.clock.advance(100);
    expect(h.client.currentState).toBe('open');
    expect(h.reconnections()).toBe(1);
    expect(h.states).toEqual(['connecting', 'open', 'reconnecting', 'open']);
  });

  it('pings and drops a silent connection', async () => {
    const h = setup();
    await h.client.open();
    await h.clock.advance(1_000);
    expect(h.signaling.last.sent.at(-1)).toEqual({ type: 'ping', t: 1_000 });
    await h.clock.advance(3_000);
    expect(h.signaling.connections[0]?.closed?.reason).toBe('heartbeat-timeout');
    await h.clock.advance(100);
    expect(h.signaling.connections).toHaveLength(2);
    h.signaling.connections[0]?.drop(); // late close of the dead socket is ignored
    expect(h.client.currentState).toBe('open');
  });

  it('fails without retrying on a fatal bridge error, with a friendly message', async () => {
    const h = setup();
    await h.client.open();
    h.signaling.last.receive({
      type: 'error',
      code: 'invalid-token',
      message: 'jwt expired',
      fatal: true,
    });
    expect(h.client.currentState).toBe('failed');
    expect(h.failures[0]?.code).toBe('bridge-rejected');
    expect(h.failures[0]?.message).toBe('El enlace de invitación no es válido o ha caducado.');
    expect(h.messages).toEqual([]);
    await h.clock.advance(10_000);
    expect(h.signaling.connections).toHaveLength(1);
  });

  it('gives up when attempts are exhausted and rejects open()', async () => {
    const h = setup(2);
    h.signaling.failNext = 10;
    const opened = h.client.open();
    opened.catch(() => undefined);
    await flushMicrotasks();
    await h.clock.advance(100);
    await h.clock.advance(200);
    await expect(opened).rejects.toMatchObject({ code: 'reconnect-exhausted' });
    expect(h.client.currentState).toBe('failed');
    expect(h.clock.pendingTasks).toBe(0);
  });

  it('closes for good', async () => {
    const h = setup();
    await h.client.open();
    h.client.close('leave');
    expect(h.signaling.last.closed).toEqual({ code: 1000, reason: 'leave' });
    expect(h.client.currentState).toBe('closed');
    h.client.close();
    expect(h.clock.pendingTasks).toBe(0);
  });
});
