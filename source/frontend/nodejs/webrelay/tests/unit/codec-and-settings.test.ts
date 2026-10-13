import { describe, expect, it } from 'vitest';
import {
  audioCandidates,
  h264CodecString,
  h264Level,
  selectCodec,
  videoCandidates,
} from '../../src/domain/codec-selection';
import { fitContain, overlayRect } from '../../src/domain/layout';
import {
  DEFAULT_AUDIO,
  DEFAULT_KEYFRAME_INTERVAL_SEC,
  DEFAULT_VIDEO,
  hasAudio,
  type RelaySettings,
  validateBridgeUrl,
  validateSettings,
} from '../../src/domain/relay-settings';

describe('H.264 codec strings', () => {
  it.each([
    [640, 360, 30, 30],
    [1280, 720, 30, 31],
    [1280, 720, 60, 32],
    [1920, 1080, 30, 40],
    [1920, 1080, 60, 42],
    [3840, 2160, 30, 51],
  ])('%ix%i@%i needs level %i', (w, h, fps, level) => {
    expect(h264Level(w, h, fps)).toBe(level);
  });

  it('builds RFC 6381 strings per profile', () => {
    expect(h264CodecString('high', 1920, 1080, 30)).toBe('avc1.640028');
    expect(h264CodecString('main', 1280, 720, 30)).toBe('avc1.4D401F');
    expect(h264CodecString('baseline', 1280, 720, 30)).toBe('avc1.42E01F');
  });

  it('rejects sizes beyond the level table', () => {
    expect(() => h264Level(8192, 8192, 60)).toThrow(RangeError);
  });
});

describe('codec preference', () => {
  it('prefers H.264 then VP8 for video, unless VP8 is requested', () => {
    expect(videoCandidates(1280, 720, 30).map((c) => c.family)).toEqual([
      'h264',
      'h264',
      'h264',
      'vp8',
    ]);
    expect(videoCandidates(1280, 720, 30, 'vp8')[0]?.codec).toBe('vp8');
  });

  it('prefers AAC then Opus for audio, unless Opus is requested', () => {
    expect(audioCandidates().map((c) => c.codec)).toEqual(['mp4a.40.2', 'opus']);
    expect(audioCandidates('opus').map((c) => c.codec)).toEqual(['opus', 'mp4a.40.2']);
  });

  it('selects the first supported candidate, treating probe errors as unsupported', async () => {
    const candidates = videoCandidates(1280, 720, 30);
    const picked = await selectCodec(candidates, async (c) => {
      if (c.codec.startsWith('avc1.64')) throw new Error('probe crashed');
      return c.codec.startsWith('avc1.4D');
    });
    expect(picked?.codec).toBe('avc1.4D401F');
    expect(await selectCodec(candidates, async () => false)).toBeUndefined();
  });
});

describe('layout', () => {
  it('letterboxes 4:3 into 16:9', () => {
    expect(fitContain(640, 480, 1280, 720)).toEqual({ x: 160, y: 0, width: 960, height: 720 });
  });

  it('fills the target when the source size is unknown', () => {
    expect(fitContain(0, 0, 1280, 720)).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it('places the camera overlay in the requested corner', () => {
    expect(overlayRect(1280, 720, 640, 360)).toEqual({ x: 934, y: 514, width: 320, height: 180 });
    expect(
      overlayRect(1280, 720, 640, 480, { corner: 'top-left', scale: 0.25, margin: 0.02 }),
    ).toEqual({ x: 26, y: 26, width: 320, height: 240 });
  });
});

describe('settings validation', () => {
  const valid: RelaySettings = {
    bridgeUrl: 'wss://bridge.example.com/relay',
    sources: { camera: true, microphone: true, screen: false, systemAudio: false },
    video: DEFAULT_VIDEO,
    audio: DEFAULT_AUDIO,
    keyframeIntervalSec: DEFAULT_KEYFRAME_INTERVAL_SEC,
  };

  it('accepts sensible defaults', () => {
    expect(validateSettings(valid)).toEqual({ ok: true, settings: valid });
  });

  it.each([
    ['wss://bridge.example.com', true],
    ['ws://localhost:8090/relay', true],
    ['ws://127.0.0.1:8090', true],
    ['ws://[::1]:8090', true],
    ['ws://bridge.example.com', false],
    ['https://bridge.example.com', false],
    ['not a url', false],
  ])('bridge URL %s valid=%s', (url, ok) => {
    expect(validateBridgeUrl(url) === undefined).toBe(ok);
  });

  it('requires an rtmps:// destination with a stream key when one is given', () => {
    const result = validateSettings({
      ...valid,
      destination: { url: 'rtmp://insecure.example.com/live', streamKey: ' ' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.field)).toEqual([
        'destination.url',
        'destination.streamKey',
      ]);
    }
  });

  it('reports every invalid field', () => {
    const result = validateSettings({
      ...valid,
      sources: { camera: false, microphone: true, screen: false, systemAudio: false },
      video: { ...DEFAULT_VIDEO, width: 1281, framerate: 0, bitrate: 1 },
      audio: { ...DEFAULT_AUDIO, sampleRate: 22_050, channels: 6, bitrate: 1 },
      keyframeIntervalSec: 60,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.field)).toEqual([
        'sources',
        'video.size',
        'video.framerate',
        'video.bitrate',
        'audio.sampleRate',
        'audio.channels',
        'audio.bitrate',
        'keyframeIntervalSec',
      ]);
    }
  });

  it('knows when the broadcast carries audio', () => {
    expect(hasAudio({ camera: true, microphone: false, screen: true, systemAudio: true })).toBe(
      true,
    );
    expect(hasAudio({ camera: true, microphone: false, screen: false, systemAudio: true })).toBe(
      false,
    );
  });
});
