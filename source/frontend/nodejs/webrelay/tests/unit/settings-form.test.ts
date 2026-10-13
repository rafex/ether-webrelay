import { describe, expect, it } from 'vitest';
import { formatBitrate, formatBytes, settingsFromForm } from '../../src/ui/settings-form';

describe('settingsFromForm', () => {
  it('maps raw form values into relay settings', () => {
    const settings = settingsFromForm({
      bridgeUrl: ' wss://bridge.example.com/relay ',
      camera: true,
      microphone: true,
      screen: true,
      systemAudio: false,
      resolution: '1920x1080',
      framerate: '60',
      videoBitrate: '6000',
      videoCodec: 'vp8',
      audioBitrate: '160',
      audioCodec: 'opus',
      keyframeInterval: '1.5',
    });
    expect(settings).toEqual({
      bridgeUrl: 'wss://bridge.example.com/relay',
      sources: { camera: true, microphone: true, screen: true, systemAudio: false },
      video: { width: 1920, height: 1080, framerate: 60, bitrate: 6_000_000, codec: 'vp8' },
      audio: { sampleRate: 48_000, channels: 2, bitrate: 160_000, codec: 'opus' },
      keyframeIntervalSec: 1.5,
    });
  });

  it('falls back to defaults and never carries RTMPS details', () => {
    const settings = settingsFromForm({ bridgeUrl: 'wss://b', camera: true });
    expect(settings).not.toHaveProperty('destination');
    expect(settings.video).toMatchObject({
      width: 1280,
      height: 720,
      framerate: 30,
      codec: 'h264',
    });
    expect(settings.keyframeIntervalSec).toBe(2);
  });
});

describe('formatters', () => {
  it('formats bitrates and byte counts', () => {
    expect(formatBitrate(2_500_000)).toBe('2.50 Mbps');
    expect(formatBitrate(128_000)).toBe('128 kbps');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KiB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MiB');
  });
});
