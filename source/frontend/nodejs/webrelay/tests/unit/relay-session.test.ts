import { beforeEach, describe, expect, it } from 'vitest';
import { RelaySession, type SessionState } from '../../src/application/relay-session';
import { BackpressureGate } from '../../src/domain/backpressure';
import { RelayError, RelayErrorCode } from '../../src/domain/errors';
import {
  decodeJsonPayload,
  FrameFlag,
  FrameType,
  type HelloPayload,
  TrackId,
} from '../../src/domain/protocol';
import { ReconnectPolicy } from '../../src/domain/reconnect-policy';
import {
  AUDIO_CONFIG,
  FakePipeline,
  FakeTransport,
  flushMicrotasks,
  ManualClock,
  VIDEO_CONFIG,
} from '../support/fakes';

interface Harness {
  clock: ManualClock;
  transport: FakeTransport;
  pipeline: FakePipeline;
  session: RelaySession;
  states: SessionState[];
  errors: RelayError[];
}

function createHarness(maxAttempts = 3): Harness {
  const clock = new ManualClock();
  const transport = new FakeTransport();
  const pipeline = new FakePipeline();
  const states: SessionState[] = [];
  const errors: RelayError[] = [];
  const session = new RelaySession(
    {
      pipeline,
      gate: new BackpressureGate({ highWaterMarkBytes: 1_000, criticalWaterMarkBytes: 5_000 }),
      link: {
        url: 'wss://bridge.test/relay',
        hello: { streamId: 'stream-1', token: 't0k3n', tracks: ['video', 'audio'] },
        transport,
        reconnectPolicy: new ReconnectPolicy(
          { initialDelayMs: 100, maxDelayMs: 400, multiplier: 2, jitterRatio: 0, maxAttempts },
          () => 0.5,
        ),
        timer: clock,
        time: clock,
        handshakeTimeoutMs: 1_000,
        heartbeatIntervalMs: 1_000,
        heartbeatMisses: 3,
      },
    },
    { onStateChange: (s) => states.push(s), onError: (e) => errors.push(e) },
  );
  return { clock, transport, pipeline, session, states, errors };
}

async function startLive(h: Harness): Promise<void> {
  await h.session.start();
  await flushMicrotasks();
  h.transport.last.receive({ type: 'welcome', streamId: 'stream-1', resumed: false });
}

const helloOf = (h: Harness, index: number) =>
  decodeJsonPayload<HelloPayload>(
    h.transport.connections[index]?.sent[0]?.payload ?? new Uint8Array(),
  );

describe('RelaySession handshake', () => {
  let h: Harness;
  beforeEach(() => {
    h = createHarness();
  });

  it('sends HELLO first and goes live on welcome', async () => {
    await h.session.start();
    await flushMicrotasks();
    expect(h.session.currentState).toBe('starting');
    const hello = h.transport.last.sent[0];
    expect(hello?.type).toBe(FrameType.Hello);
    expect(hello?.track).toBe(TrackId.Control);
    expect(helloOf(h, 0)).toEqual({
      protocol: 'ether-webrelay',
      version: 1,
      resume: false,
      streamId: 'stream-1',
      token: 't0k3n',
      tracks: ['video', 'audio'],
    });

    h.transport.last.receive({ type: 'welcome', streamId: 'stream-1', resumed: false });
    expect(h.session.currentState).toBe('live');
    expect(h.pipeline.keyframeRequests).toBe(1);
  });

  it('sends configs emitted before the handshake once the link is ready', async () => {
    await h.session.start();
    h.pipeline.emitConfig(VIDEO_CONFIG);
    h.pipeline.emitConfig(AUDIO_CONFIG);
    await flushMicrotasks();
    h.transport.last.receive({ type: 'welcome', streamId: 'stream-1', resumed: false });
    const configs = h.transport.last.sent.filter((f) => f.type === FrameType.Config);
    expect(configs.map((f) => decodeJsonPayload(f.payload))).toEqual([VIDEO_CONFIG, AUDIO_CONFIG]);
    expect(configs.map((f) => f.track)).toEqual([TrackId.Video, TrackId.Audio]);
  });

  it('drops media until the link is open', async () => {
    await h.session.start();
    h.pipeline.emitChunk({ track: 'video', keyframe: true });
    expect(h.session.stats.videoFramesDropped).toBe(1);
  });

  it('reconnects when the handshake times out', async () => {
    await h.session.start();
    await flushMicrotasks();
    await h.clock.advance(1_000);
    expect(h.transport.connections[0]?.closed?.reason).toBe('handshake-timeout');
    await h.clock.advance(100);
    expect(h.transport.connections).toHaveLength(2);
  });

  it('fails without retrying when the bridge rejects the stream', async () => {
    await h.session.start();
    await flushMicrotasks();
    h.transport.last.receive({
      type: 'error',
      code: 'unauthorized',
      message: 'bad token',
      fatal: true,
    });
    await flushMicrotasks();
    expect(h.session.currentState).toBe('failed');
    expect(h.errors[0]?.code).toBe(RelayErrorCode.BridgeRejected);
    expect(h.pipeline.stopped).toBe(true);
    await h.clock.advance(10_000);
    expect(h.transport.connections).toHaveLength(1);
  });

  it('ignores non-fatal errors and unknown messages', async () => {
    await startLive(h);
    h.transport.last.receive({ type: 'error', code: 'rtmps-slow', message: 'x', fatal: false });
    h.transport.last.handlers.onText('{"type":"from-the-future"}');
    h.transport.last.handlers.onText('garbage');
    expect(h.session.currentState).toBe('live');
  });

  it('surfaces pipeline start failures as a failed session', async () => {
    h.pipeline.startError = new Error('Permission denied');
    await expect(h.session.start()).rejects.toMatchObject({ code: RelayErrorCode.CaptureDenied });
    expect(h.session.currentState).toBe('failed');
  });
});

describe('RelaySession media flow', () => {
  let h: Harness;
  beforeEach(async () => {
    h = createHarness();
    await startLive(h);
  });

  const mediaFrames = () => h.transport.last.sent.filter((f) => f.type === FrameType.Media);

  it('frames chunks with track, flags, timestamps and increasing sequence numbers', () => {
    h.pipeline.emitChunk({ track: 'video', keyframe: true, timestampUs: 0 });
    h.pipeline.emitChunk({ track: 'audio', timestampUs: 10_000, durationUs: 21_333 });
    h.pipeline.emitChunk({ track: 'video', timestampUs: 33_333 });

    const frames = mediaFrames();
    expect(frames.map((f) => [f.track, f.flags, f.timestampUs])).toEqual([
      [TrackId.Video, FrameFlag.Keyframe | FrameFlag.Discontinuity, 0],
      [TrackId.Audio, FrameFlag.Discontinuity, 10_000],
      [TrackId.Video, FrameFlag.None, 33_333],
    ]);
    expect(frames[1]?.durationUs).toBe(21_333);
    const sequences = h.transport.last.sent.map((f) => f.sequence);
    expect(sequences).toEqual(sequences.map((_, i) => i));
    expect(h.session.stats).toMatchObject({
      videoFramesSent: 2,
      audioFramesSent: 1,
      keyframesSent: 1,
    });
  });

  it('drops video under backpressure and asks the encoder for a keyframe', () => {
    h.pipeline.emitChunk({ track: 'video', keyframe: true });
    const requestsBefore = h.pipeline.keyframeRequests;
    h.transport.last.bufferedAmount = 2_000;
    h.pipeline.emitChunk({ track: 'video' });
    h.pipeline.emitChunk({ track: 'audio' });
    h.transport.last.bufferedAmount = 0;
    h.pipeline.emitChunk({ track: 'video' });
    expect(h.pipeline.keyframeRequests).toBe(requestsBefore + 1);
    expect(h.session.stats).toMatchObject({ videoFramesDropped: 2, audioFramesSent: 1 });
  });

  it('forwards bridge keyframe requests to the pipeline', () => {
    const before = h.pipeline.keyframeRequests;
    h.transport.last.receive({ type: 'keyframe-request' });
    expect(h.pipeline.keyframeRequests).toBe(before + 1);
  });

  it('sends heartbeats and measures RTT from pongs', async () => {
    await h.clock.advance(1_000);
    const ping = h.transport.last.sent.at(-1);
    expect(ping?.type).toBe(FrameType.Ping);
    await h.clock.advance(40);
    h.transport.last.receive({ type: 'pong', timestampUs: ping?.timestampUs });
    expect(h.session.stats.rttMs).toBe(40);
  });

  it('says BYE and closes cleanly on stop', async () => {
    const connection = h.transport.last;
    await h.session.stop();
    expect(connection.sent.at(-1)?.type).toBe(FrameType.Bye);
    expect(connection.closed).toEqual({ code: 1000, reason: 'client-stop' });
    expect(h.pipeline.stopped).toBe(true);
    expect(h.states.at(-1)).toBe('stopped');
    await h.clock.advance(10_000);
    expect(h.transport.connections).toHaveLength(1);
  });
});

describe('RelaySession reconnection', () => {
  it('resumes the stream after a drop: HELLO resume, configs replayed, keyframe forced', async () => {
    const h = createHarness();
    await startLive(h);
    h.pipeline.emitConfig(VIDEO_CONFIG);
    h.pipeline.emitChunk({ track: 'video', keyframe: true, timestampUs: 0 });
    h.pipeline.emitChunk({ track: 'video', timestampUs: 33_333 });
    const lastSequence = h.transport.last.sent.at(-1)?.sequence ?? -1;

    h.transport.last.drop();
    expect(h.session.currentState).toBe('reconnecting');
    h.pipeline.emitChunk({ track: 'video', timestampUs: 66_666 }); // lost while down
    await h.clock.advance(100);
    expect(h.transport.connections).toHaveLength(2);

    const keyframeRequests = h.pipeline.keyframeRequests;
    h.transport.last.receive({ type: 'welcome', streamId: 'stream-1', resumed: true });
    expect(h.session.currentState).toBe('live');
    expect(helloOf(h, 1).resume).toBe(true);
    expect(h.pipeline.keyframeRequests).toBe(keyframeRequests + 1);

    h.pipeline.emitChunk({ track: 'video', timestampUs: 99_999 }); // delta: still dropped
    h.pipeline.emitChunk({ track: 'video', keyframe: true, timestampUs: 133_333 });

    const second = h.transport.last.sent;
    expect(second.map((f) => f.type)).toEqual([FrameType.Hello, FrameType.Config, FrameType.Media]);
    expect(second[0]?.sequence).toBe(lastSequence + 1);
    expect(second[2]?.flags).toBe(FrameFlag.Keyframe | FrameFlag.Discontinuity);
    expect(second[2]?.timestampUs).toBe(133_333);
    expect(h.session.stats).toMatchObject({ reconnects: 1, videoFramesDropped: 2 });
  });

  it('backs off between failed attempts and gives up when exhausted', async () => {
    const h = createHarness(3);
    await startLive(h);
    h.transport.failNext = 10;
    h.transport.last.drop();
    await h.clock.advance(100); // attempt 1 fails
    await h.clock.advance(200); // attempt 2 fails
    await h.clock.advance(400); // attempt 3 fails → exhausted
    expect(h.transport.urls).toHaveLength(4);
    expect(h.session.currentState).toBe('failed');
    expect(h.errors[0]?.code).toBe(RelayErrorCode.ReconnectExhausted);
    expect(h.clock.pendingTasks).toBe(0);
  });

  it('presumes the connection dead after missed heartbeats and reconnects', async () => {
    const h = createHarness();
    await startLive(h);
    await h.clock.advance(4_000); // silent bridge: 3 intervals missed
    expect(h.transport.connections[0]?.closed?.reason).toBe('heartbeat-timeout');
    await h.clock.advance(100);
    expect(h.transport.connections).toHaveLength(2);
  });

  it('ignores close events from superseded connections', async () => {
    const h = createHarness();
    await startLive(h);
    await h.clock.advance(4_000); // heartbeat abandons connection 0
    await h.clock.advance(100);
    h.transport.connections[0]?.drop(); // late close event from the dead socket
    await h.clock.advance(1_000);
    expect(h.transport.connections).toHaveLength(2);
  });

  it('reports session states across a reconnection', async () => {
    const h = createHarness();
    await startLive(h);
    h.transport.last.drop();
    await h.clock.advance(100);
    h.transport.last.receive({ type: 'welcome', streamId: 'stream-1', resumed: false });
    expect(h.states).toEqual(['starting', 'live', 'reconnecting', 'live']);
  });
});

describe('RelayError', () => {
  it('carries a machine-readable code', () => {
    const error = new RelayError(RelayErrorCode.NoSources, 'nothing to stream');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RelayError');
    expect(error.code).toBe('no-sources');
  });
});
