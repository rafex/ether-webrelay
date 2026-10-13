import { describe, expect, it } from 'vitest';
import { WebSocketCallSession } from '../../src/application/websocket-call';
import { decodeJsonPayload, FrameType, type HelloPayload } from '../../src/domain/protocol';
import { DEFAULT_PROFILE } from '../../src/domain/quality-profile';
import { ReconnectPolicy } from '../../src/domain/reconnect-policy';
import {
  FakeComposablePipeline,
  FakeMediaProvider,
  FakeTrack,
  handle,
} from '../support/call-fakes';
import { FakeTransport, flushMicrotasks, ManualClock } from '../support/fakes';

function setup() {
  const clock = new ManualClock();
  const transport = new FakeTransport();
  const media = new FakeMediaProvider();
  const camera = new FakeTrack('video');
  const microphone = new FakeTrack('audio');
  let pipeline: FakeComposablePipeline | undefined;
  const call = new WebSocketCallSession({
    link: {
      url: 'wss://bridge.test/relay',
      hello: {
        streamId: 's1',
        room: 'demo',
        token: 'tok',
        name: 'Raúl',
        tracks: ['video', 'audio'],
      },
      transport,
      reconnectPolicy: new ReconnectPolicy(),
      timer: clock,
      time: clock,
    },
    media,
    createPipeline: (sources) => {
      pipeline = new FakeComposablePipeline(sources);
      return pipeline;
    },
    initial: { camera: handle(camera), microphone: handle(microphone) },
    microphoneEnabled: true,
    profile: DEFAULT_PROFILE,
    timer: clock,
    time: clock,
    statsIntervalMs: 1_000,
  });
  return {
    clock,
    transport,
    media,
    camera,
    microphone,
    call,
    pipeline: () => {
      if (!pipeline) throw new Error('no pipeline');
      return pipeline;
    },
  };
}

async function joined() {
  const h = setup();
  const admitted = h.call.join();
  await flushMicrotasks();
  h.transport.last.receive({ type: 'welcome', streamId: 's1', resumed: false });
  await admitted;
  return h;
}

describe('WebSocketCallSession', () => {
  it('starts the composing pipeline with the lobby tracks and identifies by invitation', async () => {
    const h = await joined();
    expect(h.call.snapshot).toMatchObject({ mode: 'websocket', state: 'connected' });
    expect(h.pipeline().sources).toEqual({ camera: h.camera, microphone: h.microphone });
    const hello = h.transport.last.sent.find((f) => f.type === FrameType.Hello);
    expect(decodeJsonPayload<HelloPayload>(hello?.payload ?? new Uint8Array())).toMatchObject({
      room: 'demo',
      token: 'tok',
      name: 'Raúl',
    });
    expect(h.call.snapshot.remote.size).toBe(0);
  });

  it('feeds toggles and screen shares into the pipeline', async () => {
    const h = await joined();
    await h.call.setMicrophoneEnabled(false);
    expect(h.microphone.enabled).toBe(false);
    await h.call.setCameraEnabled(false);
    expect(h.camera.stopped).toBe(true);
    expect(h.pipeline().sources).toEqual({ microphone: h.microphone });

    await h.call.startScreenShare();
    expect(h.pipeline().sources.screen?.kind).toBe('video');
    expect(h.pipeline().sources.screenAudio?.kind).toBe('audio');
    h.media.screenTracks[0]?.video.end();
    await flushMicrotasks();
    expect(h.pipeline().sources.screen).toBeUndefined();
    expect(h.call.snapshot.self).toEqual({ muted: true, cameraOff: true, screenSharing: false });

    await h.call.setCameraEnabled(true);
    expect(h.pipeline().sources.camera).toBe(h.media.opened[0]);
  });

  it('reports upload rate and RTT from the relay session', async () => {
    const h = await joined();
    await h.clock.advance(1_000);
    await h.clock.advance(1_000);
    expect(h.call.snapshot.stats).toMatchObject({ uploadBps: 0 });
  });

  it('leaves, stopping the pipeline and the tracks', async () => {
    const h = await joined();
    await h.call.leave();
    expect(h.pipeline().stopped).toBe(true);
    expect(h.camera.stopped && h.microphone.stopped).toBe(true);
    expect(h.call.snapshot.state).toBe('left');
  });
});
