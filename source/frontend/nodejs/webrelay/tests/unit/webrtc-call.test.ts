import { describe, expect, it } from 'vitest';
import type { CallSnapshot } from '../../src/application/call-controller';
import { SignalingClient } from '../../src/application/signaling-client';
import { WebRtcCallSession } from '../../src/application/webrtc-call';
import { DEFAULT_PROFILE } from '../../src/domain/quality-profile';
import { ReconnectPolicy } from '../../src/domain/reconnect-policy';
import type { ServerMessage } from '../../src/domain/signaling';
import {
  FakeMediaProvider,
  FakePeerFactory,
  FakeSignaling,
  FakeTrack,
  handle,
  participant,
} from '../support/call-fakes';
import { ManualClock } from '../support/fakes';

const WELCOME: ServerMessage = {
  type: 'welcome',
  self: 'p-me',
  resumed: false,
  profile: { ...DEFAULT_PROFILE, videoBitrate: 1_000_000 },
  iceServers: [{ urls: 'stun:stun.test' }],
  participants: [participant('p-ana', 'Ana')],
};

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

async function setup(
  options: { camera?: boolean; microphone?: boolean; micEnabled?: boolean } = {},
) {
  const clock = new ManualClock();
  const signaling = new FakeSignaling();
  const peers = new FakePeerFactory();
  const media = new FakeMediaProvider();
  const client = new SignalingClient({
    url: 'wss://bridge.test/signal',
    signaling,
    reconnectPolicy: new ReconnectPolicy({
      initialDelayMs: 100,
      maxDelayMs: 100,
      multiplier: 1,
      jitterRatio: 0,
      maxAttempts: 5,
    }),
    timer: clock,
    time: clock,
    heartbeatIntervalMs: 60_000,
  });
  await client.open();
  const camera = new FakeTrack('video', 'cam', { width: 1920, height: 1080 });
  const microphone = new FakeTrack('audio', 'mic');
  const call = new WebRtcCallSession({
    client,
    peers,
    media,
    timer: clock,
    time: clock,
    identity: { name: 'Raúl', title: 'Invitado' },
    initial: {
      ...(options.camera === false ? {} : { camera: handle(camera) }),
      ...(options.microphone === false ? {} : { microphone: handle(microphone) }),
    },
    microphoneEnabled: options.micEnabled ?? true,
    defaultProfile: DEFAULT_PROFILE,
    resolution: 'auto',
    statsIntervalMs: 1_000,
  });
  const snapshots: CallSnapshot[] = [];
  call.subscribe((s) => snapshots.push(s));
  const conn = () => signaling.last;
  const receive = async (message: ServerMessage) => {
    conn().receive(message);
    await settle();
  };
  return {
    clock,
    signaling,
    peers,
    media,
    client,
    call,
    camera,
    microphone,
    snapshots,
    conn,
    receive,
  };
}

async function joined(options?: Parameters<typeof setup>[0]) {
  const h = await setup(options);
  const admitted = h.call.join();
  await h.receive(WELCOME);
  await admitted;
  return h;
}

describe('WebRtcCallSession — joining', () => {
  it('joins with identity and media, then publishes with the bridge profile', async () => {
    const h = await setup();
    const admitted = h.call.join();
    expect(h.conn().ofType('join')).toEqual([
      { type: 'join', name: 'Raúl', title: 'Invitado', media: { audio: true, video: true } },
    ]);
    await h.receive(WELCOME);
    await admitted;

    expect(h.call.snapshot.state).toBe('connected');
    expect(h.peers.created).toHaveLength(2);
    const publish = h.peers.publish;
    expect(publish.iceServers).toEqual([{ urls: 'stun:stun.test' }]);
    expect(publish.senders.map((s) => s.track)).toEqual([h.camera, h.microphone]);
    // 1080p camera under a 720p profile at 1 Mbps: scaled 1.5x, full profile area.
    expect(publish.senders[0]?.initialEncoding).toEqual({
      maxBitrate: 1_000_000,
      maxFramerate: 30,
      scaleResolutionDownBy: 1.5,
    });
    expect(h.conn().ofType('publish.offer')).toEqual([
      { type: 'publish.offer', sdp: 'offer-1', sources: { '0': 'camera', '1': 'microphone' } },
    ]);
    expect(h.conn().ofType('self.update').at(-1)).toEqual({
      type: 'self.update',
      muted: false,
      cameraOff: false,
      screenSharing: false,
    });
    expect(h.call.snapshot.room.participants.map((p) => p.name)).toEqual(['Ana']);
    expect(h.call.snapshot.profile.videoBitrate).toBe(1_000_000);
  });

  it('joins muted when the lobby left the microphone off', async () => {
    const h = await joined({ micEnabled: false });
    expect(h.microphone.enabled).toBe(false);
    expect(h.call.snapshot.self.muted).toBe(true);
  });

  it('queues remote ICE until the answer is applied, and forwards local ICE', async () => {
    const h = await joined();
    await h.receive({ type: 'ice', pc: 'publish', candidate: { candidate: 'remote-1' } });
    expect(h.peers.publish.candidates).toEqual([]);
    await h.receive({ type: 'publish.answer', sdp: 'answer' });
    expect(h.peers.publish.acceptedAnswers).toEqual(['answer']);
    expect(h.peers.publish.candidates.map((c) => c.candidate)).toEqual(['remote-1']);
    await h.receive({ type: 'ice', pc: 'publish', candidate: { candidate: 'remote-2' } });
    expect(h.peers.publish.candidates).toHaveLength(2);

    h.peers.publish.emitCandidate('local-1');
    expect(h.conn().ofType('ice').at(-1)).toEqual({
      type: 'ice',
      pc: 'publish',
      candidate: { candidate: 'local-1', sdpMid: '0', sdpMLineIndex: 0 },
    });
  });

  it('answers the subscribe offer and maps remote tracks to participants', async () => {
    const h = await joined();
    await h.receive({ type: 'participant.joined', participant: participant('p-beto', 'Beto') });
    await h.receive({ type: 'subscribe.offer', sdp: 'sub-offer' });
    expect(h.conn().ofType('subscribe.answer')).toEqual([
      { type: 'subscribe.answer', sdp: 'answer-1' },
    ]);

    const anaCam = new FakeTrack('video');
    const betoScreen = new FakeTrack('video');
    h.peers.subscribe.emitTrack('0', anaCam);
    h.peers.subscribe.emitTrack('1', betoScreen);
    await h.receive({
      type: 'tracks',
      tracks: {
        '0': { participant: 'p-ana', source: 'camera' },
        '1': { participant: 'p-beto', source: 'screen' },
      },
    });
    expect(h.call.snapshot.remote.get('p-ana')?.camera).toBe(anaCam);
    expect(h.call.snapshot.remote.get('p-beto')?.screen).toBe(betoScreen);

    await h.receive({ type: 'participant.left', id: 'p-beto' });
    expect(h.call.snapshot.remote.has('p-beto')).toBe(false);
    anaCam.end();
    expect(h.call.snapshot.remote.has('p-ana')).toBe(false);
  });
});

describe('WebRtcCallSession — in-call controls', () => {
  it('mutes by disabling the track, without renegotiating', async () => {
    const h = await joined();
    await h.call.setMicrophoneEnabled(false);
    expect(h.microphone.enabled).toBe(false);
    expect(h.call.snapshot.self.muted).toBe(true);
    expect(h.conn().ofType('self.update').at(-1)).toMatchObject({ muted: true });
    expect(h.peers.publish.offers).toHaveLength(1);
  });

  it('turns the camera off and on by swapping the sender track', async () => {
    const h = await joined();
    const sender = h.peers.publish.senders[0];
    await h.call.setCameraEnabled(false);
    expect(sender?.track).toBeNull();
    expect(h.camera.stopped).toBe(true);
    expect(h.call.snapshot.local.camera).toBeUndefined();
    await h.call.setCameraEnabled(true);
    expect(sender?.track).toBe(h.media.opened[0]);
    expect(h.peers.publish.offers).toHaveLength(1);
    expect(h.call.snapshot.self.cameraOff).toBe(false);
  });

  it('joins to watch without media, then publishes when a device is enabled', async () => {
    const h = await joined({ camera: false, microphone: false });
    expect(h.conn().ofType('join')[0]?.media).toEqual({ audio: false, video: false });
    expect(h.peers.publish.senders).toHaveLength(0);
    expect(h.peers.publish.offers).toEqual([]); // no empty offer
    await h.call.setCameraEnabled(true);
    await h.call.setMicrophoneEnabled(true);
    // The second request waits for the first offer's answer, then collapses into one.
    expect(h.peers.publish.offers).toEqual(['offer-1']);
    await h.receive({ type: 'publish.answer', sdp: 'a1' });
    expect(h.peers.publish.offers).toEqual(['offer-1', 'offer-2']);
    await h.receive({ type: 'publish.answer', sdp: 'a2' });
    expect(h.peers.publish.offers).toHaveLength(2);
    expect(h.peers.publish.senders).toHaveLength(2);
  });

  it('shares the screen with its own encoding and stops when the browser ends it', async () => {
    const h = await joined();
    await h.receive({ type: 'publish.answer', sdp: 'a1' });
    await h.call.startScreenShare();
    const [, , screenSender, screenAudioSender] = h.peers.publish.senders;
    expect(screenSender?.initialEncoding).toEqual({
      maxBitrate: DEFAULT_PROFILE.screenBitrate,
      maxFramerate: DEFAULT_PROFILE.screenFramerate,
      scaleResolutionDownBy: 2,
    });
    expect(screenAudioSender?.track?.kind).toBe('audio');
    expect(h.conn().ofType('publish.offer').at(-1)?.sources).toEqual({
      '0': 'camera',
      '1': 'microphone',
      '2': 'screen',
      '3': 'screen-audio',
    });
    expect(h.call.snapshot.self.screenSharing).toBe(true);
    expect(h.conn().ofType('self.update').at(-1)).toMatchObject({ screenSharing: true });
    await h.call.startScreenShare(); // idempotent

    h.media.screenTracks[0]?.video.end();
    await settle();
    expect(screenSender?.track).toBeNull();
    expect(screenAudioSender?.track).toBeNull();
    expect(h.call.snapshot.self.screenSharing).toBe(false);

    await h.receive({ type: 'publish.answer', sdp: 'a2' });
    await h.call.startScreenShare(); // reuses the transceivers: no new offer
    expect(h.peers.publish.offers).toHaveLength(2);
    expect(h.peers.publish.senders).toHaveLength(4);
  });

  it('replaces the camera (device or effect change) and keeps mute on mic swaps', async () => {
    const h = await joined();
    const next = new FakeTrack('video', 'usb', { width: 1280, height: 720 });
    await h.call.replaceCamera(handle(next));
    expect(h.peers.publish.senders[0]?.track).toBe(next);
    expect(h.camera.stopped).toBe(true);
    expect(h.peers.publish.senders[0]?.encodings.at(-1)?.scaleResolutionDownBy).toBe(1);

    await h.call.setMicrophoneEnabled(false);
    const mic = new FakeTrack('audio');
    await h.call.replaceMicrophone(handle(mic));
    expect(mic.enabled).toBe(false);

    await h.call.setCameraEnabled(false);
    const ignored = new FakeTrack('video');
    await h.call.replaceCamera(handle(ignored));
    expect(ignored.stopped).toBe(true);
  });

  it('applies profile changes to the camera sender', async () => {
    const h = await joined();
    await h.receive({ type: 'profile', profile: { ...DEFAULT_PROFILE, videoBitrate: 600_000 } });
    expect(h.peers.publish.senders[0]?.encodings.at(-1)?.maxBitrate).toBe(600_000);
    expect(h.call.snapshot.profile.videoBitrate).toBe(600_000);
  });

  it('samples stats periodically', async () => {
    const h = await joined();
    h.peers.publish.statsRecords = [
      { id: 'o', type: 'outbound-rtp', kind: 'video', bytesSent: 1000 },
    ];
    await h.clock.advance(1_000);
    await settle();
    expect(h.call.snapshot.stats?.bytesSent).toBe(1000);
  });
});

describe('WebRtcCallSession — resilience', () => {
  it('restarts ICE when the publish connection fails', async () => {
    const h = await joined();
    await h.receive({ type: 'publish.answer', sdp: 'a1' });
    h.peers.publish.emitState('failed');
    await settle();
    expect(h.peers.publish.offers.at(-1)).toBe('offer-2-restart');
  });

  it('rejoins after a signaling drop, keeping peers when the bridge resumes', async () => {
    const h = await joined();
    h.conn().drop();
    expect(h.call.snapshot.state).toBe('reconnecting');
    await h.clock.advance(100);
    expect(h.conn().ofType('join')[0]).toMatchObject({ resume: 'p-me' });
    await h.receive({ ...WELCOME, resumed: true } as ServerMessage);
    expect(h.peers.created).toHaveLength(2);
    expect(h.call.snapshot.state).toBe('connected');
  });

  it('rebuilds peers when the bridge could not resume', async () => {
    const h = await joined();
    const oldPublish = h.peers.publish;
    h.conn().drop();
    await h.clock.advance(100);
    await h.receive(WELCOME);
    expect(oldPublish.closed).toBe(true);
    expect(h.peers.created).toHaveLength(4);
    expect(h.peers.publish.senders.map((s) => s.track)).toEqual([h.camera, h.microphone]);
  });

  it('fails on a fatal error, releasing devices and rejecting join', async () => {
    const h = await setup();
    const admitted = h.call.join();
    h.conn().receive({ type: 'error', code: 'room-full', message: '', fatal: true });
    await expect(admitted).rejects.toMatchObject({ message: 'La sala está llena.' });
    expect(h.call.snapshot.state).toBe('failed');
    expect(h.camera.stopped).toBe(true);
    expect(h.microphone.stopped).toBe(true);
  });

  it('fails when negotiation breaks', async () => {
    const h = await joined();
    h.peers.publish.failAcceptAnswer = true;
    await h.receive({ type: 'publish.answer', sdp: 'garbage' });
    expect(h.call.snapshot.state).toBe('failed');
    expect(h.call.snapshot.error?.code).toBe('protocol');
    expect(h.client.currentState).toBe('failed');
  });

  it('leaves cleanly', async () => {
    const h = await joined();
    await h.call.leave();
    expect(h.signaling.connections[0]?.sent.at(-1)).toEqual({ type: 'leave' });
    expect(h.peers.created.every((p) => p.closed)).toBe(true);
    expect(h.camera.stopped && h.microphone.stopped).toBe(true);
    expect(h.call.snapshot.state).toBe('left');
    expect(h.clock.pendingTasks).toBe(0);
    await h.call.leave();
  });
});
