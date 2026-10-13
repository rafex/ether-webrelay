import { RelayError, RelayErrorCode } from '../../domain/errors';
import type { SourceSelection, VideoSettings } from '../../domain/relay-settings';

export interface CapturedMedia {
  readonly camera?: MediaStreamTrack;
  readonly microphone?: MediaStreamTrack;
  readonly screen?: MediaStreamTrack;
  readonly systemAudio?: MediaStreamTrack;
  /** Stops every captured track and releases the devices. */
  stop(): void;
  /** Called when the user ends the screen share from the browser UI. */
  onScreenEnded(callback: () => void): void;
}

/** Fails fast with a clear error instead of an obscure `undefined is not a function`. */
export function assertBrowserSupport(): void {
  if (!globalThis.isSecureContext) {
    throw new RelayError(
      RelayErrorCode.InsecureContext,
      'Ether WebRelay debe servirse por HTTPS (o desde localhost).',
    );
  }
  const missing = [
    ['navigator.mediaDevices', globalThis.navigator?.mediaDevices],
    ['VideoEncoder', globalThis.VideoEncoder],
    ['AudioEncoder', globalThis.AudioEncoder],
    ['VideoFrame', globalThis.VideoFrame],
    ['AudioData', globalThis.AudioData],
    ['AudioWorkletNode', globalThis.AudioWorkletNode],
    ['WebSocket', globalThis.WebSocket],
  ]
    .filter(([, api]) => api === undefined)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new RelayError(
      RelayErrorCode.UnsupportedBrowser,
      `Este navegador no tiene las APIs necesarias: ${missing.join(', ')}`,
    );
  }
}

/**
 * Requests camera/microphone (`getUserMedia`) and screen (`getDisplayMedia`).
 * The browser's picker lets the user choose a tab, window or full screen and,
 * where supported, whether to share tab/system audio.
 */
export async function captureMedia(
  sources: SourceSelection,
  video: VideoSettings,
): Promise<CapturedMedia> {
  if (!sources.camera && !sources.screen) {
    throw new RelayError(
      RelayErrorCode.NoSources,
      'Selecciona una cámara o una pantalla para transmitir.',
    );
  }
  const acquired: MediaStream[] = [];
  const stopAll = () => {
    for (const stream of acquired) for (const track of stream.getTracks()) track.stop();
  };

  try {
    let screenStream: MediaStream | undefined;
    if (sources.screen) {
      // Ask for the screen first: getDisplayMedia needs the user gesture that started the broadcast.
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: video.framerate },
          width: { max: 3840 },
          height: { max: 2160 },
        },
        audio: sources.systemAudio
          ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
          : false,
        // Chromium hints; ignored elsewhere.
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        systemAudio: sources.systemAudio ? 'include' : 'exclude',
        monitorTypeSurfaces: 'include',
      } as DisplayMediaStreamOptions);
      acquired.push(screenStream);
    }

    let userStream: MediaStream | undefined;
    if (sources.camera || sources.microphone) {
      userStream = await navigator.mediaDevices.getUserMedia({
        video: sources.camera
          ? {
              width: { ideal: video.width },
              height: { ideal: video.height },
              frameRate: { ideal: video.framerate },
            }
          : false,
        audio: sources.microphone
          ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          : false,
      });
      acquired.push(userStream);
    }

    const screen = screenStream?.getVideoTracks()[0];
    if (screen) screen.contentHint = 'detail';
    const camera = userStream?.getVideoTracks()[0];
    if (camera) camera.contentHint = 'motion';

    return {
      ...(camera ? { camera } : {}),
      ...optional('microphone', userStream?.getAudioTracks()[0]),
      ...(screen ? { screen } : {}),
      ...optional('systemAudio', screenStream?.getAudioTracks()[0]),
      stop: stopAll,
      onScreenEnded(callback) {
        screen?.addEventListener('ended', callback, { once: true });
      },
    };
  } catch (error) {
    stopAll();
    if (error instanceof RelayError) throw error;
    const name = (error as DOMException).name;
    const message =
      name === 'NotAllowedError'
        ? 'Se denegó el permiso de captura.'
        : name === 'NotFoundError'
          ? 'No se encontró una cámara o micrófono compatible.'
          : `Falló la captura: ${(error as Error).message}`;
    throw new RelayError(RelayErrorCode.CaptureDenied, message, { cause: error });
  }
}

function optional<K extends string>(
  key: K,
  track: MediaStreamTrack | undefined,
): Partial<Record<K, MediaStreamTrack>> {
  return track ? ({ [key]: track } as Record<K, MediaStreamTrack>) : {};
}
