/**
 * Quality profile dictated by the bridge (`welcome.profile`), with defaults
 * from config.json. The participant never edits bitrates; they only pick a
 * camera resolution, which is capped by the profile.
 */
export interface QualityProfile {
  readonly width: number;
  readonly height: number;
  readonly framerate: number;
  readonly videoBitrate: number;
  readonly audioBitrate: number;
  /** Screen shares favour detail over motion. */
  readonly screenFramerate: number;
  readonly screenBitrate: number;
}

export const DEFAULT_PROFILE: QualityProfile = {
  width: 1280,
  height: 720,
  framerate: 30,
  videoBitrate: 2_500_000,
  audioBitrate: 128_000,
  screenFramerate: 15,
  screenBitrate: 2_500_000,
};

export type ResolutionChoice = 'auto' | '360p' | '720p' | '1080p';

export const RESOLUTION_CHOICES: readonly ResolutionChoice[] = ['auto', '360p', '720p', '1080p'];

const RESOLUTION_SIZES: Record<Exclude<ResolutionChoice, 'auto'>, Size> = {
  '360p': { width: 640, height: 360 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Shape of the WebRTC sender encoding we control (kept free of DOM types). */
export interface SendEncoding {
  readonly maxBitrate: number;
  readonly maxFramerate: number;
  readonly scaleResolutionDownBy: number;
}

export interface AudioProcessing {
  readonly echoCancellation: boolean;
  readonly noiseSuppression: boolean;
  readonly autoGainControl: boolean;
  /** RNNoise (neural, in an AudioWorklet) instead of the browser's noise suppression. */
  readonly rnnoise: boolean;
  /** Voice leveler: gentle compression, make-up gain and a peak limiter. */
  readonly leveler: boolean;
}

export const DEFAULT_AUDIO_PROCESSING: AudioProcessing = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  rnnoise: false,
  leveler: false,
};

export function isResolutionChoice(value: unknown): value is ResolutionChoice {
  return typeof value === 'string' && (RESOLUTION_CHOICES as readonly string[]).includes(value);
}

/** Camera size to aim for: the choice, never above what the profile allows. */
export function targetCameraSize(choice: ResolutionChoice, profile: QualityProfile): Size {
  if (choice === 'auto') return { width: profile.width, height: profile.height };
  const wanted = RESOLUTION_SIZES[choice];
  return wanted.height > profile.height ? { width: profile.width, height: profile.height } : wanted;
}

/** Choices that make sense under this profile (larger ones would be capped anyway). */
export function availableResolutions(profile: QualityProfile): ResolutionChoice[] {
  return RESOLUTION_CHOICES.filter(
    (choice) => choice === 'auto' || RESOLUTION_SIZES[choice].height <= profile.height,
  );
}

/** Capture constraints for `getUserMedia` (plain data; the adapter adds them to the call). */
export function cameraConstraints(
  choice: ResolutionChoice,
  profile: QualityProfile,
  deviceId?: string,
): Record<string, unknown> {
  const size = targetCameraSize(choice, profile);
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: size.width },
    height: { ideal: size.height },
    frameRate: { ideal: profile.framerate, max: profile.framerate },
  };
}

export function microphoneConstraints(
  processing: AudioProcessing,
  deviceId?: string,
): Record<string, unknown> {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: processing.echoCancellation,
    // RNNoise replaces the browser's suppression: running both would process the voice twice.
    noiseSuppression: processing.noiseSuppression && !processing.rnnoise,
    autoGainControl: processing.autoGainControl,
  };
}

/**
 * Sender limits for the camera. The bitrate scales with the pixel area actually
 * sent, so a 360p choice under a 720p profile does not waste bandwidth.
 */
export function cameraEncoding(
  profile: QualityProfile,
  choice: ResolutionChoice,
  captured: Size,
): SendEncoding {
  const target = targetCameraSize(choice, profile);
  const scale = downscaleFactor(captured, target);
  const sentArea = (captured.width / scale) * (captured.height / scale);
  const profileArea = profile.width * profile.height;
  const ratio = Math.min(1, sentArea / profileArea);
  return {
    maxBitrate: Math.max(150_000, Math.round(profile.videoBitrate * ratio)),
    maxFramerate: profile.framerate,
    scaleResolutionDownBy: scale,
  };
}

/** Screen shares keep up to 1080p of detail at the profile's screen bitrate. */
export function screenEncoding(profile: QualityProfile, captured: Size): SendEncoding {
  return {
    maxBitrate: profile.screenBitrate,
    maxFramerate: profile.screenFramerate,
    scaleResolutionDownBy: downscaleFactor(captured, { width: 1920, height: 1080 }),
  };
}

function downscaleFactor(captured: Size, target: Size): number {
  if (captured.width <= 0 || captured.height <= 0) return 1;
  const factor = Math.max(captured.width / target.width, captured.height / target.height);
  return Math.max(1, Math.round(factor * 100) / 100);
}

/** Validates a profile received from the bridge or config; returns undefined if unusable. */
export function parseQualityProfile(
  raw: unknown,
  fallback: QualityProfile = DEFAULT_PROFILE,
): QualityProfile | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const pick = (key: keyof QualityProfile, min: number, max: number): number | undefined => {
    const candidate = value[key];
    if (candidate === undefined) return fallback[key];
    return typeof candidate === 'number' && candidate >= min && candidate <= max
      ? candidate
      : undefined;
  };
  const profile = {
    width: pick('width', 160, 3840),
    height: pick('height', 90, 2160),
    framerate: pick('framerate', 1, 60),
    videoBitrate: pick('videoBitrate', 100_000, 20_000_000),
    audioBitrate: pick('audioBitrate', 32_000, 320_000),
    screenFramerate: pick('screenFramerate', 1, 60),
    screenBitrate: pick('screenBitrate', 100_000, 20_000_000),
  };
  return Object.values(profile).every((v) => v !== undefined)
    ? (profile as QualityProfile)
    : undefined;
}
