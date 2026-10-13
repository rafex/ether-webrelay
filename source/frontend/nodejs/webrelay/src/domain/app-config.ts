import { DEFAULT_PROFILE, parseQualityProfile, type QualityProfile } from './quality-profile';
import { validateBridgeUrl } from './relay-settings';
import type { TransportMode } from './signaling';
import { isViewMode, type ViewMode } from './view-mode';

/**
 * Deployment configuration served next to the site (`/config.json`, mountable
 * in the container). It is the only place that knows where the bridge lives.
 */
export interface AppConfig {
  /** Signaling endpoint (room info, join, WebRTC negotiation). */
  readonly bridgeUrl: string;
  /** Binary media endpoint for the `websocket` transport; defaults to `bridgeUrl`. */
  readonly relayUrl: string;
  readonly transport: TransportMode;
  readonly defaultProfile: QualityProfile;
  readonly defaultView: ViewMode;
  /** Segmentation model for background effects; self-host it by pointing to `/models/…`. */
  readonly effectsModelUrl: string;
}

export const DEFAULT_EFFECTS_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

export type AppConfigResult =
  | { readonly ok: true; readonly config: AppConfig }
  | { readonly ok: false; readonly issues: readonly string[] };

export function parseAppConfig(raw: unknown): AppConfigResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, issues: ['config.json debe ser un objeto JSON'] };
  }
  const value = raw as Record<string, unknown>;
  const issues: string[] = [];

  const bridgeUrl = typeof value.bridgeUrl === 'string' ? value.bridgeUrl : '';
  const bridgeIssue = validateBridgeUrl(bridgeUrl);
  if (bridgeIssue) issues.push(`bridgeUrl: ${bridgeIssue.message}`);

  const relayUrl = typeof value.relayUrl === 'string' ? value.relayUrl : bridgeUrl;
  const relayIssue = value.relayUrl === undefined ? undefined : validateBridgeUrl(relayUrl);
  if (relayIssue) issues.push(`relayUrl: ${relayIssue.message}`);

  const transport = value.transport ?? 'webrtc';
  if (transport !== 'webrtc' && transport !== 'websocket') {
    issues.push('transport debe ser "webrtc" o "websocket"');
  }

  const defaultProfile =
    value.defaultProfile === undefined
      ? DEFAULT_PROFILE
      : parseQualityProfile(value.defaultProfile);
  if (!defaultProfile) issues.push('defaultProfile tiene valores fuera de rango');

  const defaultView = value.defaultView ?? 'stage';
  if (!isViewMode(defaultView)) issues.push('defaultView debe ser "stage", "minimal" o "stats"');

  const effectsModelUrl =
    typeof value.effectsModelUrl === 'string' ? value.effectsModelUrl : DEFAULT_EFFECTS_MODEL_URL;
  if (!/^(https:\/\/|\/)/.test(effectsModelUrl)) {
    issues.push('effectsModelUrl debe ser https:// o una ruta del propio sitio (/models/…)');
  }

  if (issues.length > 0 || !defaultProfile || !isViewMode(defaultView)) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    config: {
      bridgeUrl,
      relayUrl,
      transport: transport as TransportMode,
      defaultProfile,
      defaultView,
      effectsModelUrl,
    },
  };
}
