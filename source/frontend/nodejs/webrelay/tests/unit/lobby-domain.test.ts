import { describe, expect, it } from 'vitest';
import { DEFAULT_EFFECTS_MODEL_URL, parseAppConfig } from '../../src/domain/app-config';
import { parseInvite } from '../../src/domain/invite';
import { gridLayout, spotlightLayout } from '../../src/domain/layout';
import {
  DEFAULT_PREFERENCES,
  initials,
  sanitizePreferences,
  validateIdentity,
} from '../../src/domain/preferences';
import {
  availableResolutions,
  cameraConstraints,
  cameraEncoding,
  DEFAULT_PROFILE,
  microphoneConstraints,
  parseQualityProfile,
  screenEncoding,
  targetCameraSize,
} from '../../src/domain/quality-profile';
import { relaySettingsFromProfile } from '../../src/domain/relay-settings';
import { resolveShortcut } from '../../src/domain/shortcuts';
import { isViewMode, nextViewMode } from '../../src/domain/view-mode';

describe('parseInvite', () => {
  it('extracts room and token from /join/<room>?t=<token>', () => {
    expect(parseInvite('/join/jdh-s02e38', '?t=abc.def')).toEqual({
      ok: true,
      invite: { room: 'jdh-s02e38', token: 'abc.def' },
    });
    expect(parseInvite('/app/join/Room_1/', '?x=1&t=tok')).toMatchObject({
      ok: true,
      invite: { room: 'Room_1' },
    });
  });

  it.each([
    ['/', '?t=x', 'missing-room'],
    ['/join/', '?t=x', 'missing-room'],
    ['/join/..', '?t=x', 'invalid-room'],
    ['/join/%E0%A4%A', '?t=x', 'invalid-room'],
    ['/join/room', '', 'missing-token'],
    ['/join/room', '?t=%20', 'missing-token'],
  ])('rejects %s%s with %s', (path, search, reason) => {
    expect(parseInvite(path, search)).toEqual({ ok: false, reason });
  });
});

describe('parseAppConfig', () => {
  it('fills defaults around the bridge URL', () => {
    expect(parseAppConfig({ bridgeUrl: 'wss://bridge.example.com/signal' })).toEqual({
      ok: true,
      config: {
        bridgeUrl: 'wss://bridge.example.com/signal',
        relayUrl: 'wss://bridge.example.com/signal',
        transport: 'webrtc',
        defaultProfile: DEFAULT_PROFILE,
        defaultView: 'stage',
        effectsModelUrl: DEFAULT_EFFECTS_MODEL_URL,
      },
    });
  });

  it('accepts the websocket transport with its own relay URL', () => {
    const result = parseAppConfig({
      bridgeUrl: 'ws://localhost:8090/signal',
      relayUrl: 'ws://localhost:8090/relay',
      transport: 'websocket',
      defaultView: 'minimal',
      defaultProfile: { width: 640, height: 360 },
    });
    expect(result).toMatchObject({
      ok: true,
      config: { transport: 'websocket', defaultView: 'minimal', defaultProfile: { width: 640 } },
    });
  });

  it('reports every problem', () => {
    const result = parseAppConfig({
      bridgeUrl: 'http://bridge',
      relayUrl: 'ws://evil.example.com',
      transport: 'carrier-pigeon',
      defaultProfile: { framerate: 500 },
      defaultView: 'cinema',
      effectsModelUrl: 'http://evil.example.com/model.tflite',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toHaveLength(6);
    expect(parseAppConfig(null)).toMatchObject({ ok: false });
  });
});

describe('quality profile', () => {
  it('caps the camera choice at the profile and lists only sensible choices', () => {
    expect(targetCameraSize('auto', DEFAULT_PROFILE)).toEqual({ width: 1280, height: 720 });
    expect(targetCameraSize('360p', DEFAULT_PROFILE)).toEqual({ width: 640, height: 360 });
    expect(targetCameraSize('1080p', DEFAULT_PROFILE)).toEqual({ width: 1280, height: 720 });
    expect(availableResolutions(DEFAULT_PROFILE)).toEqual(['auto', '360p', '720p']);
  });

  it('builds capture constraints', () => {
    expect(cameraConstraints('360p', DEFAULT_PROFILE, 'cam-1')).toEqual({
      deviceId: { exact: 'cam-1' },
      width: { ideal: 640 },
      height: { ideal: 360 },
      frameRate: { ideal: 30, max: 30 },
    });
    expect(
      microphoneConstraints({
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: true,
      }),
    ).toEqual({ echoCancellation: false, noiseSuppression: true, autoGainControl: true });
  });

  it('scales camera bitrate with the area actually sent', () => {
    expect(cameraEncoding(DEFAULT_PROFILE, 'auto', { width: 1280, height: 720 })).toEqual({
      maxBitrate: 2_500_000,
      maxFramerate: 30,
      scaleResolutionDownBy: 1,
    });
    // 1080p camera, 360p choice: scaled down 3x → 640x360, a quarter of the 720p profile area.
    expect(cameraEncoding(DEFAULT_PROFILE, '360p', { width: 1920, height: 1080 })).toEqual({
      maxBitrate: 625_000,
      maxFramerate: 30,
      scaleResolutionDownBy: 3,
    });
  });

  it('limits screen shares to 1080p of detail', () => {
    expect(screenEncoding(DEFAULT_PROFILE, { width: 3840, height: 2160 })).toEqual({
      maxBitrate: 2_500_000,
      maxFramerate: 15,
      scaleResolutionDownBy: 2,
    });
    expect(screenEncoding(DEFAULT_PROFILE, { width: 0, height: 0 }).scaleResolutionDownBy).toBe(1);
  });

  it('validates profiles field by field, defaulting missing ones', () => {
    expect(parseQualityProfile({})).toEqual(DEFAULT_PROFILE);
    expect(parseQualityProfile({ videoBitrate: 1 })).toBeUndefined();
    expect(parseQualityProfile('720p')).toBeUndefined();
  });

  it('derives WebCodecs settings for the websocket transport', () => {
    const settings = relaySettingsFromProfile(
      'wss://b',
      { ...DEFAULT_PROFILE, videoBitrate: 1_000_000 },
      {
        camera: true,
        microphone: true,
        screen: false,
        systemAudio: false,
      },
    );
    expect(settings.video).toMatchObject({ width: 1280, height: 720, bitrate: 1_000_000 });
    expect(settings.audio.bitrate).toBe(128_000);
  });
});

describe('preferences and identity', () => {
  it('sanitizes untrusted storage', () => {
    expect(sanitizePreferences('garbage')).toEqual(DEFAULT_PREFERENCES);
    expect(
      sanitizePreferences({
        name: 'x'.repeat(200),
        cameraId: 'cam',
        microphoneId: '',
        resolution: '8k',
        mirror: false,
        audio: { echoCancellation: false },
        view: 'stats',
        effect: { kind: 'image', imageId: 'aurora' },
      }),
    ).toEqual({
      ...DEFAULT_PREFERENCES,
      name: 'x'.repeat(60),
      cameraId: 'cam',
      mirror: false,
      audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true },
      view: 'stats',
      effect: { kind: 'image', imageId: 'aurora' },
    });
    expect(sanitizePreferences({ effect: { kind: 'image', imageId: '../../etc' } }).effect).toEqual(
      {
        kind: 'none',
      },
    );
    expect(sanitizePreferences({ effect: { kind: 'blur', strength: 'strong' } }).effect).toEqual({
      kind: 'blur',
      strength: 'strong',
    });
  });

  it('validates the display name and optional title', () => {
    expect(validateIdentity('  Raúl   González ', '  Host ')).toEqual({
      ok: true,
      name: 'Raúl González',
      title: 'Host',
    });
    expect(validateIdentity('Ana', '')).toEqual({ ok: true, name: 'Ana' });
    expect(validateIdentity('   ', '')).toMatchObject({ ok: false });
    expect(validateIdentity('a'.repeat(61), '')).toMatchObject({ ok: false });
    expect(validateIdentity('Ana', 't'.repeat(81))).toMatchObject({ ok: false });
  });

  it('computes initials', () => {
    expect(initials('Ana María López')).toBe('AL');
    expect(initials('beto')).toBe('B');
    expect(initials('')).toBe('?');
  });
});

describe('view modes and shortcuts', () => {
  it('cycles through the three views', () => {
    expect(nextViewMode('stage')).toBe('minimal');
    expect(nextViewMode('minimal')).toBe('stats');
    expect(nextViewMode('stats')).toBe('stage');
    expect(isViewMode('stats')).toBe(true);
    expect(isViewMode('cinema')).toBe(false);
  });

  it('resolves shortcuts only outside text fields and without modifiers', () => {
    const key = (k: string, extra: Partial<Parameters<typeof resolveShortcut>[0]> = {}) =>
      resolveShortcut({
        key: k,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        editableTarget: false,
        ...extra,
      });
    expect(key('M')).toBe('toggle-microphone');
    expect(key('v')).toBe('toggle-camera');
    expect(key('s')).toBe('toggle-screen');
    expect(key('l')).toBe('cycle-view');
    expect(key(',')).toBe('open-settings');
    expect(key('m', { editableTarget: true })).toBeUndefined();
    expect(key('s', { metaKey: true })).toBeUndefined();
    expect(key('x')).toBeUndefined();
  });
});

describe('grid and spotlight layouts', () => {
  it('lays out a centred 16:9 mosaic', () => {
    expect(gridLayout(0, 1280, 720)).toEqual([]);
    const one = gridLayout(1, 1280, 720, 0);
    expect(one).toEqual([{ x: 0, y: 0, width: 1280, height: 720 }]);
    const three = gridLayout(3, 1280, 720, 0);
    expect(three).toHaveLength(3);
    expect(three[0]).toEqual({ x: 0, y: 0, width: 640, height: 360 });
    // Incomplete last row is centred.
    expect(three[2]).toEqual({ x: 320, y: 360, width: 640, height: 360 });
  });

  it('puts the screen share beside the thumbnails', () => {
    expect(spotlightLayout(0, 1280, 720).main).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    const layout = spotlightLayout(2, 1280, 720, 0);
    expect(layout.thumbnails).toHaveLength(2);
    expect(layout.main.x + layout.main.width).toBeLessThanOrEqual(960);
    expect(layout.thumbnails[0]?.x).toBeGreaterThanOrEqual(960);
  });
});
