import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RelaySession } from '../../src/application/relay-session';
import { type RelayError, RelayErrorCode } from '../../src/domain/errors';
import { decodeJsonPayload, FrameFlag, FrameType, TrackId } from '../../src/domain/protocol';
import { ReconnectPolicy } from '../../src/domain/reconnect-policy';
import { performanceTimeSource } from '../../src/infrastructure/time/performance-time-source';
import {
  SUBPROTOCOL,
  WebSocketTransport,
} from '../../src/infrastructure/transport/websocket-transport';
import { systemTimer } from '../../src/ports/time';
import { AUDIO_CONFIG, FakePipeline, VIDEO_CONFIG } from '../support/fakes';
import { MockBridge } from '../support/mock-bridge';

/**
 * Full client path over a real socket: RelaySession → BridgeLink → protocol
 * encoding → WebSocketTransport (platform WebSocket) → mock bridge.
 * Only capture/encoding is faked, since WebCodecs does not exist in Node.
 */
describe('relay flow over a real WebSocket', () => {
  let bridge: MockBridge;
  let pipeline: FakePipeline;
  let session: RelaySession;
  let errors: RelayError[];

  const createSession = (token = 'secret') =>
    new RelaySession(
      {
        pipeline,
        link: {
          url: bridge.url,
          hello: { streamId: 'it-stream', token, tracks: ['video', 'audio'] },
          transport: new WebSocketTransport(),
          reconnectPolicy: new ReconnectPolicy({
            initialDelayMs: 20,
            maxDelayMs: 100,
            multiplier: 2,
            jitterRatio: 0,
            maxAttempts: 5,
          }),
          timer: systemTimer,
          time: performanceTimeSource,
          heartbeatIntervalMs: 50,
        },
      },
      { onError: (error) => errors.push(error) },
    );

  beforeEach(async () => {
    bridge = await MockBridge.start({ token: 'secret' });
    pipeline = new FakePipeline();
    errors = [];
  });

  afterEach(async () => {
    await session?.stop();
    await bridge.close();
  });

  it('streams configs and interleaved audio/video with a shared timeline', async () => {
    session = createSession();
    await session.start();
    pipeline.emitConfig(VIDEO_CONFIG);
    pipeline.emitConfig(AUDIO_CONFIG);
    await waitFor(() => session.currentState === 'live');
    expect(bridge.last.protocol).toBe(SUBPROTOCOL);

    for (let i = 0; i < 30; i++) {
      pipeline.emitChunk({ track: 'video', keyframe: i % 15 === 0, timestampUs: i * 33_333 });
      pipeline.emitChunk({ track: 'audio', timestampUs: i * 20_000, durationUs: 20_000 });
    }
    await bridge.until(
      () => bridge.last.frames.filter((f) => f.type === FrameType.Media).length === 60,
    );

    const frames = bridge.last.frames;
    expect(frames[0]?.type).toBe(FrameType.Hello);
    expect(bridge.last.hello).toMatchObject({
      protocol: 'ether-webrelay',
      version: 1,
      resume: false,
    });
    const configs = frames
      .filter((f) => f.type === FrameType.Config)
      .map((f) => decodeJsonPayload(f.payload));
    expect(configs).toEqual([VIDEO_CONFIG, AUDIO_CONFIG]);

    const video = frames.filter((f) => f.type === FrameType.Media && f.track === TrackId.Video);
    const audio = frames.filter((f) => f.type === FrameType.Media && f.track === TrackId.Audio);
    expect(video.map((f) => f.timestampUs)).toEqual(
      Array.from({ length: 30 }, (_, i) => i * 33_333),
    );
    expect(audio.map((f) => f.timestampUs)).toEqual(
      Array.from({ length: 30 }, (_, i) => i * 20_000),
    );
    expect(video.filter((f) => f.flags & FrameFlag.Keyframe)).toHaveLength(2);
    expect(frames.map((f) => f.sequence)).toEqual(frames.map((_, i) => i));
  });

  it('answers heartbeats and reports RTT', async () => {
    session = createSession();
    await session.start();
    await waitFor(() => session.stats.rttMs !== undefined);
    expect(session.stats.rttMs).toBeGreaterThanOrEqual(0);
  });

  it('reconnects after a network drop and resumes the same stream', async () => {
    session = createSession();
    await session.start();
    pipeline.emitConfig(VIDEO_CONFIG);
    await waitFor(() => session.currentState === 'live');
    pipeline.emitChunk({ track: 'video', keyframe: true, timestampUs: 0 });
    await bridge.until(() => bridge.last.frames.some((f) => f.type === FrameType.Media));
    const firstSequence = bridge.last.frames.at(-1)?.sequence ?? 0;

    bridge.dropAll();
    await waitFor(() => bridge.connections.length === 2 && session.currentState === 'live');
    expect(bridge.last.hello).toMatchObject({ streamId: 'it-stream', resume: true });
    expect(session.stats.reconnects).toBe(1);
    expect(pipeline.keyframeRequests).toBeGreaterThanOrEqual(2);

    pipeline.emitChunk({ track: 'video', timestampUs: 1_000_000 }); // delta: dropped until keyframe
    pipeline.emitChunk({ track: 'video', keyframe: true, timestampUs: 1_033_333 });
    await bridge.until(() => bridge.last.frames.some((f) => f.type === FrameType.Media));

    const resumed = bridge.last.frames;
    expect(resumed.map((f) => f.type)).toEqual([
      FrameType.Hello,
      FrameType.Config,
      FrameType.Media,
    ]);
    expect(resumed[0]?.sequence).toBeGreaterThan(firstSequence);
    expect(resumed[2]).toMatchObject({
      flags: FrameFlag.Keyframe | FrameFlag.Discontinuity,
      timestampUs: 1_033_333,
    });
  });

  it('stops for good when the bridge rejects the credentials', async () => {
    session = createSession('wrong');
    await session.start();
    await waitFor(() => session.currentState === 'failed');
    expect(errors[0]?.code).toBe(RelayErrorCode.BridgeRejected);
    expect(pipeline.stopped).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(bridge.connections).toHaveLength(1);
  });

  it('says BYE on stop', async () => {
    session = createSession();
    await session.start();
    await waitFor(() => session.currentState === 'live');
    await session.stop();
    await bridge.until(() => bridge.last.frames.at(-1)?.type === FrameType.Bye);
    expect(decodeJsonPayload(bridge.last.frames.at(-1)?.payload ?? new Uint8Array())).toEqual({
      reason: 'client-stop',
    });
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
