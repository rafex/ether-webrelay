import {
  type AudioProcessing,
  DEFAULT_AUDIO_PROCESSING,
  isResolutionChoice,
  type ResolutionChoice,
} from './quality-profile';
import { isViewMode, type ViewMode } from './view-mode';

export type BlurStrength = 'light' | 'strong';

/** Camera effect applied before publishing. Custom uploads live only for the session. */
export type VideoEffect =
  | { readonly kind: 'none' }
  | { readonly kind: 'blur'; readonly strength: BlurStrength }
  | { readonly kind: 'image'; readonly imageId: string };

export const NO_EFFECT: VideoEffect = { kind: 'none' };

/** Built-in backgrounds, drawn procedurally by the effects adapter (no image assets). */
export const PRESET_BACKGROUNDS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'aurora', label: 'Aurora' },
  { id: 'sunset', label: 'Atardecer' },
  { id: 'studio', label: 'Estudio' },
];

export interface UserPreferences {
  readonly name: string;
  readonly title: string;
  readonly cameraId?: string;
  readonly microphoneId?: string;
  readonly speakerId?: string;
  readonly cameraEnabled: boolean;
  readonly microphoneEnabled: boolean;
  readonly resolution: ResolutionChoice;
  readonly mirror: boolean;
  readonly audio: AudioProcessing;
  readonly view?: ViewMode;
  readonly effect: VideoEffect;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  name: '',
  title: '',
  cameraEnabled: true,
  microphoneEnabled: true,
  resolution: 'auto',
  mirror: true,
  audio: DEFAULT_AUDIO_PROCESSING,
  effect: NO_EFFECT,
};

export const MAX_NAME_LENGTH = 60;
export const MAX_TITLE_LENGTH = 80;

/** Rebuilds preferences from untrusted storage, dropping anything malformed. */
export function sanitizePreferences(raw: unknown): UserPreferences {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFERENCES;
  const v = raw as Record<string, unknown>;
  const str = (key: string, max: number) =>
    typeof v[key] === 'string' ? (v[key] as string).slice(0, max) : '';
  const id = (key: string) =>
    typeof v[key] === 'string' && v[key] !== '' ? { [key]: v[key] as string } : {};
  const bool = (value: unknown, fallback: boolean) =>
    typeof value === 'boolean' ? value : fallback;
  const audio = (typeof v.audio === 'object' && v.audio !== null ? v.audio : {}) as Record<
    string,
    unknown
  >;
  return {
    name: str('name', MAX_NAME_LENGTH),
    title: str('title', MAX_TITLE_LENGTH),
    ...id('cameraId'),
    ...id('microphoneId'),
    ...id('speakerId'),
    cameraEnabled: bool(v.cameraEnabled, true),
    microphoneEnabled: bool(v.microphoneEnabled, true),
    resolution: isResolutionChoice(v.resolution) ? v.resolution : 'auto',
    mirror: bool(v.mirror, true),
    audio: {
      echoCancellation: bool(audio.echoCancellation, true),
      noiseSuppression: bool(audio.noiseSuppression, true),
      autoGainControl: bool(audio.autoGainControl, true),
    },
    ...(isViewMode(v.view) ? { view: v.view } : {}),
    effect: sanitizeEffect(v.effect),
  };
}

function sanitizeEffect(raw: unknown): VideoEffect {
  if (typeof raw !== 'object' || raw === null) return NO_EFFECT;
  const effect = raw as Record<string, unknown>;
  if (effect.kind === 'blur' && (effect.strength === 'light' || effect.strength === 'strong')) {
    return { kind: 'blur', strength: effect.strength };
  }
  if (
    effect.kind === 'image' &&
    typeof effect.imageId === 'string' &&
    PRESET_BACKGROUNDS.some((bg) => bg.id === effect.imageId)
  ) {
    return { kind: 'image', imageId: effect.imageId };
  }
  return NO_EFFECT;
}

export type NameValidation =
  | { readonly ok: true; readonly name: string; readonly title?: string }
  | { readonly ok: false; readonly message: string };

/** Display name shown to other participants and to the bridge (for on-air labels). */
export function validateIdentity(name: string, title: string): NameValidation {
  const cleanName = name.trim().replace(/\s+/g, ' ');
  const cleanTitle = title.trim().replace(/\s+/g, ' ');
  if (cleanName === '') return { ok: false, message: 'Escribe tu nombre para entrar.' };
  if (cleanName.length > MAX_NAME_LENGTH) {
    return { ok: false, message: `El nombre admite hasta ${MAX_NAME_LENGTH} caracteres.` };
  }
  if (cleanTitle.length > MAX_TITLE_LENGTH) {
    return { ok: false, message: `El título admite hasta ${MAX_TITLE_LENGTH} caracteres.` };
  }
  return { ok: true, name: cleanName, ...(cleanTitle ? { title: cleanTitle } : {}) };
}

/** Initials for avatar placeholders ("Ana María López" → "AL"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '?';
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
