import type { AudioCodecFamily, VideoCodecFamily } from '../domain/protocol';
import { DEFAULT_AUDIO, DEFAULT_VIDEO, type RelaySettings } from '../domain/relay-settings';

/** Raw form values: text inputs as strings, checkboxes as booleans. */
export type FormValues = Readonly<Record<string, string | boolean | undefined>>;

/** Maps raw form values to settings; validation is left to `validateSettings`. */
export function settingsFromForm(values: FormValues): RelaySettings {
  const text = (key: string) =>
    typeof values[key] === 'string' ? (values[key] as string).trim() : '';
  const flag = (key: string) => values[key] === true;
  const number = (key: string, fallback: number) => {
    const parsed = Number(text(key));
    return text(key) === '' || Number.isNaN(parsed) ? fallback : parsed;
  };
  const resolution = /^(\d+)x(\d+)$/.exec(text('resolution'));
  const width = resolution ? Number(resolution[1]) : DEFAULT_VIDEO.width;
  const height = resolution ? Number(resolution[2]) : DEFAULT_VIDEO.height;

  const token = text('token');
  const destinationUrl = text('destinationUrl');
  const streamKey = text('streamKey');

  return {
    bridgeUrl: text('bridgeUrl'),
    ...(token ? { token } : {}),
    ...(destinationUrl || streamKey ? { destination: { url: destinationUrl, streamKey } } : {}),
    sources: {
      camera: flag('camera'),
      microphone: flag('microphone'),
      screen: flag('screen'),
      systemAudio: flag('systemAudio'),
    },
    video: {
      width,
      height,
      framerate: number('framerate', DEFAULT_VIDEO.framerate),
      bitrate: number('videoBitrate', DEFAULT_VIDEO.bitrate / 1000) * 1000,
      codec: (text('videoCodec') || DEFAULT_VIDEO.codec) as VideoCodecFamily,
    },
    audio: {
      ...DEFAULT_AUDIO,
      bitrate: number('audioBitrate', DEFAULT_AUDIO.bitrate / 1000) * 1000,
      codec: (text('audioCodec') || DEFAULT_AUDIO.codec) as AudioCodecFamily,
    },
    keyframeIntervalSec: number('keyframeInterval', 2),
  };
}

export function formatBitrate(bitsPerSecond: number): string {
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(2)} Mbps`;
  return `${Math.round(bitsPerSecond / 1000)} kbps`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

/** Stable per-tab stream id, reused across reconnections of the same broadcast. */
export function newStreamId(): string {
  return `wr-${crypto.randomUUID()}`;
}
