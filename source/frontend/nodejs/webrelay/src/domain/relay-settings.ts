import type { AudioCodecFamily, VideoCodecFamily } from './protocol';
import type { QualityProfile } from './quality-profile';

export interface SourceSelection {
  readonly camera: boolean;
  readonly microphone: boolean;
  readonly screen: boolean;
  /** Tab/system audio offered by `getDisplayMedia` (browser and OS dependent). */
  readonly systemAudio: boolean;
}

export interface VideoSettings {
  readonly width: number;
  readonly height: number;
  readonly framerate: number;
  readonly bitrate: number;
  readonly codec: VideoCodecFamily;
}

export interface AudioSettings {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitrate: number;
  readonly codec: AudioCodecFamily;
}

/** Media settings for the `websocket` (WebCodecs) transport. Never carries RTMPS details. */
export interface RelaySettings {
  readonly bridgeUrl: string;
  readonly sources: SourceSelection;
  readonly video: VideoSettings;
  readonly audio: AudioSettings;
  readonly keyframeIntervalSec: number;
}

export const DEFAULT_VIDEO: VideoSettings = {
  width: 1280,
  height: 720,
  framerate: 30,
  bitrate: 2_500_000,
  codec: 'h264',
};

export const DEFAULT_AUDIO: AudioSettings = {
  sampleRate: 48_000,
  channels: 2,
  bitrate: 128_000,
  codec: 'aac',
};

export const DEFAULT_KEYFRAME_INTERVAL_SEC = 2;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export interface SettingsIssue {
  readonly field: string;
  readonly message: string;
}

export type SettingsResult =
  | { readonly ok: true; readonly settings: RelaySettings }
  | { readonly ok: false; readonly issues: readonly SettingsIssue[] };

/**
 * Bridge URLs must be `wss://`. Plain `ws://` is tolerated only for loopback
 * hosts so a local bridge can be used during development.
 */
export function validateBridgeUrl(value: string): SettingsIssue | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { field: 'bridgeUrl', message: 'La URL del puente no es válida' };
  }
  if (url.protocol === 'wss:') return undefined;
  if (url.protocol === 'ws:' && LOCAL_HOSTS.has(url.hostname)) return undefined;
  return {
    field: 'bridgeUrl',
    message: 'La URL del puente debe usar wss:// (ws:// solo se permite en localhost)',
  };
}

export function validateSettings(settings: RelaySettings): SettingsResult {
  const issues: SettingsIssue[] = [];
  const bridgeIssue = validateBridgeUrl(settings.bridgeUrl);
  if (bridgeIssue) issues.push(bridgeIssue);

  const { sources, video, audio } = settings;
  if (!sources.camera && !sources.screen) {
    issues.push({
      field: 'sources',
      message: 'Selecciona al menos una fuente de video (cámara o pantalla)',
    });
  }
  if (!isEvenInRange(video.width, 160, 3840) || !isEvenInRange(video.height, 90, 2160)) {
    issues.push({
      field: 'video.size',
      message: 'La resolución debe ser par, entre 160x90 y 3840x2160',
    });
  }
  if (!inRange(video.framerate, 1, 60)) {
    issues.push({ field: 'video.framerate', message: 'Los FPS deben estar entre 1 y 60' });
  }
  if (!inRange(video.bitrate, 100_000, 20_000_000)) {
    issues.push({
      field: 'video.bitrate',
      message: 'El bitrate de video debe estar entre 0.1 y 20 Mbps',
    });
  }
  if (![44_100, 48_000].includes(audio.sampleRate)) {
    issues.push({
      field: 'audio.sampleRate',
      message: 'La frecuencia de muestreo debe ser 44100 o 48000',
    });
  }
  if (![1, 2].includes(audio.channels)) {
    issues.push({ field: 'audio.channels', message: 'El audio debe ser mono o estéreo' });
  }
  if (!inRange(audio.bitrate, 32_000, 320_000)) {
    issues.push({
      field: 'audio.bitrate',
      message: 'El bitrate de audio debe estar entre 32 y 320 kbps',
    });
  }
  if (!inRange(settings.keyframeIntervalSec, 0.5, 10)) {
    issues.push({
      field: 'keyframeIntervalSec',
      message: 'El intervalo de keyframes debe estar entre 0.5 y 10 s',
    });
  }
  return issues.length === 0 ? { ok: true, settings } : { ok: false, issues };
}

/** Derives WebCodecs settings from the bridge's quality profile. */
export function relaySettingsFromProfile(
  bridgeUrl: string,
  profile: QualityProfile,
  sources: SourceSelection,
): RelaySettings {
  return {
    bridgeUrl,
    sources,
    video: {
      ...DEFAULT_VIDEO,
      width: profile.width,
      height: profile.height,
      framerate: profile.framerate,
      bitrate: profile.videoBitrate,
    },
    audio: { ...DEFAULT_AUDIO, bitrate: profile.audioBitrate },
    keyframeIntervalSec: DEFAULT_KEYFRAME_INTERVAL_SEC,
  };
}

export function hasAudio(sources: SourceSelection): boolean {
  return sources.microphone || (sources.screen && sources.systemAudio);
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function isEvenInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value % 2 === 0 && inRange(value, min, max);
}
