import { RelayError, RelayErrorCode } from '../domain/errors';
import type { TransportMode } from '../domain/signaling';

const COMMON: readonly string[] = ['navigator.mediaDevices', 'WebSocket'];
const BY_TRANSPORT: Record<TransportMode, readonly string[]> = {
  webrtc: ['RTCPeerConnection'],
  websocket: ['VideoEncoder', 'AudioEncoder', 'VideoFrame', 'AudioData', 'AudioWorkletNode'],
};

/** Fails fast with a clear message instead of an obscure `undefined is not a function`. */
export function assertBrowserSupport(transport: TransportMode): void {
  if (!globalThis.isSecureContext) {
    throw new RelayError(
      RelayErrorCode.InsecureContext,
      'Ether WebRelay debe abrirse por HTTPS (o desde localhost) para usar cámara y micrófono.',
    );
  }
  const missing = [...COMMON, ...BY_TRANSPORT[transport]].filter((api) => !available(api));
  if (missing.length > 0) {
    throw new RelayError(
      RelayErrorCode.UnsupportedBrowser,
      `Este navegador no tiene las APIs necesarias: ${missing.join(', ')}`,
    );
  }
}

function available(path: string): boolean {
  let value: unknown = globalThis;
  for (const key of path.split('.')) {
    if (value === undefined || value === null) return false;
    value = (value as Record<string, unknown>)[key];
  }
  return value !== undefined;
}
