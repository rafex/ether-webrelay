import { describe, expect, it } from 'vitest';
import { LobbyService } from '../../src/application/lobby-service';
import { SignalingClient } from '../../src/application/signaling-client';
import { DEFAULT_PREFERENCES } from '../../src/domain/preferences';
import { DEFAULT_PROFILE } from '../../src/domain/quality-profile';
import { ReconnectPolicy } from '../../src/domain/reconnect-policy';
import type { VideoEffectsPort } from '../../src/ports/video-effects';
import { FakeDevices, FakeSignaling, FakeTrack, MemoryPreferences } from '../support/call-fakes';
import { flushMicrotasks, ManualClock } from '../support/fakes';

const ROOM_INFO = {
  type: 'room.info' as const,
  room: 'jdh-s02e38',
  title: 'Jueves de Hacking S02 EP38',
  host: { name: 'ichavero1' },
  channels: ['youtube', 'twitch'],
};

function setup(options: { effects?: VideoEffectsPort; prefs?: MemoryPreferences } = {}) {
  const clock = new ManualClock();
  const signaling = new FakeSignaling();
  const devices = new FakeDevices();
  const preferences = options.prefs ?? new MemoryPreferences();
  const client = new SignalingClient({
    url: 'wss://bridge.test/signal',
    signaling,
    reconnectPolicy: new ReconnectPolicy({
      initialDelayMs: 100,
      maxDelayMs: 100,
      multiplier: 1,
      jitterRatio: 0,
      maxAttempts: 3,
    }),
    timer: clock,
    time: clock,
  });
  const lobby = new LobbyService({
    invite: { room: 'jdh-s02e38', token: 'tok' },
    client,
    devices,
    preferences,
    profile: DEFAULT_PROFILE,
    ...(options.effects ? { effects: options.effects } : {}),
  });
  return { clock, signaling, devices, preferences, client, lobby };
}

describe('LobbyService', () => {
  it('peeks the room, opens the preview and lists devices', async () => {
    const h = setup();
    await h.lobby.start();
    expect(h.signaling.last.sent).toEqual([
      { type: 'room.peek', room: 'jdh-s02e38', token: 'tok' },
    ]);
    expect(h.lobby.snapshot.phase).toBe('connecting');

    h.signaling.last.receive(ROOM_INFO);
    const snapshot = h.lobby.snapshot;
    expect(snapshot.phase).toBe('ready');
    expect(snapshot.room?.title).toBe('Jueves de Hacking S02 EP38');
    expect(snapshot.camera?.kind).toBe('video');
    expect(snapshot.microphone?.kind).toBe('audio');
    expect(snapshot.devices.map((d) => d.kind)).toEqual([
      'videoinput',
      'audioinput',
      'audiooutput',
    ]);
    expect(h.devices.cameraCalls[0]).toMatchObject({
      width: { ideal: 1280 },
      height: { ideal: 720 },
    });
    expect(h.devices.microphoneCalls[0]).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  });

  it('reports an invalid invitation as rejected', async () => {
    const h = setup();
    await h.lobby.start();
    h.signaling.last.receive({ type: 'error', code: 'room-not-found', message: '', fatal: true });
    expect(h.lobby.snapshot).toMatchObject({
      phase: 'rejected',
      error: 'La sala no existe o ya terminó.',
    });
  });

  it('reports an unreachable bridge', async () => {
    const h = setup();
    h.signaling.failNext = 10;
    const started = h.lobby.start();
    for (let i = 0; i < 4; i++) {
      await flushMicrotasks();
      await h.clock.advance(100);
    }
    await started;
    expect(h.lobby.snapshot.phase).toBe('unreachable');
  });

  it('keeps going without a camera when permission is denied', async () => {
    const h = setup();
    h.devices.denyCamera = true;
    await h.lobby.start();
    h.signaling.last.receive(ROOM_INFO);
    expect(h.lobby.snapshot).toMatchObject({
      phase: 'ready',
      mediaError: 'Se denegó el permiso para usar la cámara.',
    });
    expect(h.lobby.snapshot.camera).toBeUndefined();
    expect(h.lobby.snapshot.microphone).toBeDefined();
  });

  it('toggles camera and microphone, releasing devices and saving the choice', async () => {
    const h = setup();
    await h.lobby.start();
    const firstCamera = h.lobby.snapshot.camera as FakeTrack;
    await h.lobby.setCameraEnabled(false);
    expect(firstCamera.stopped).toBe(true);
    expect(h.lobby.snapshot.camera).toBeUndefined();
    expect(h.preferences.load().cameraEnabled).toBe(false);
    await h.lobby.setCameraEnabled(true);
    expect(h.lobby.snapshot.camera).toBeDefined();
    await h.lobby.setMicrophoneEnabled(false);
    expect(h.lobby.snapshot.microphone).toBeUndefined();
  });

  it('reopens only the affected device when preferences change', async () => {
    const h = setup();
    await h.lobby.start();
    await h.lobby.updatePreferences({ cameraId: 'cam-2', resolution: '360p' });
    expect(h.devices.cameraCalls.at(-1)).toMatchObject({
      deviceId: { exact: 'cam-2' },
      width: { ideal: 640 },
    });
    expect(h.devices.microphoneCalls).toHaveLength(1);
    await h.lobby.updatePreferences({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
    });
    expect(h.devices.microphoneCalls.at(-1)).toMatchObject({ echoCancellation: false });
    expect(h.devices.cameraCalls).toHaveLength(2);
    await h.lobby.updatePreferences({ name: 'Ana', mirror: false });
    expect(h.devices.cameraCalls).toHaveLength(2);
    expect(h.preferences.load()).toMatchObject({ name: 'Ana', mirror: false });
  });

  it('hands the preview to the call without stopping it', async () => {
    const h = setup();
    await h.lobby.start();
    const { camera, microphone } = h.lobby.takePreview();
    expect((camera?.track as FakeTrack | undefined)?.stopped).toBe(false);
    expect(microphone).toBeDefined();
    expect(h.lobby.snapshot.camera).toBeUndefined();
    await h.lobby.updatePreferences({ cameraId: 'cam-2' });
    expect(h.devices.cameraCalls).toHaveLength(1); // no preview reopen during the call
    const reopened = await h.lobby.openCamera();
    expect(reopened.track.kind).toBe('video');
    expect(h.devices.cameraCalls.at(-1)).toMatchObject({ deviceId: { exact: 'cam-2' } });
  });

  it('applies the camera effect and stops both tracks', async () => {
    const processed = new FakeTrack('video', 'blurred');
    let processingStopped = false;
    const h = setup({
      effects: {
        apply: async () => ({
          track: processed,
          stop: () => {
            processingStopped = true;
          },
        }),
      },
      prefs: new MemoryPreferences({
        ...DEFAULT_PREFERENCES,
        effect: { kind: 'blur', strength: 'light' },
      }),
    });
    await h.lobby.start();
    expect(h.lobby.snapshot.camera).toBe(processed);
    await h.lobby.setCameraEnabled(false);
    expect(processingStopped).toBe(true);
    expect(h.devices.tracks[0]?.stopped).toBe(true);
  });

  it('re-peeks after reconnecting and refreshes devices on change', async () => {
    const h = setup();
    await h.lobby.start();
    h.signaling.last.drop();
    await h.clock.advance(100);
    expect(h.signaling.last.sent).toEqual([
      { type: 'room.peek', room: 'jdh-s02e38', token: 'tok' },
    ]);
    h.devices.plugIn({ id: 'cam-2', kind: 'videoinput', label: 'Cámara USB' });
    await flushMicrotasks();
    expect(h.lobby.snapshot.devices.map((d) => d.id)).toContain('cam-2');
  });

  it('releases everything on dispose', async () => {
    const h = setup();
    await h.lobby.start();
    h.lobby.dispose();
    expect(h.devices.tracks.every((t) => t.stopped)).toBe(true);
  });
});
