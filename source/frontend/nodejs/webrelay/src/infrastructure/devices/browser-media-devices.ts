import { RelayError, RelayErrorCode } from '../../domain/errors';
import type {
  DeviceInfo,
  DeviceKind,
  MediaDevicesPort,
  MediaTrackLike,
  ScreenCapture,
} from '../../ports/media';

const KIND_LABELS: Record<DeviceKind, string> = {
  videoinput: 'Cámara',
  audioinput: 'Micrófono',
  audiooutput: 'Altavoz',
};

/** MediaDevicesPort over navigator.mediaDevices. */
export class BrowserMediaDevices implements MediaDevicesPort {
  private get devices(): MediaDevices {
    const devices = globalThis.navigator?.mediaDevices;
    if (!devices) {
      throw new RelayError(
        RelayErrorCode.UnsupportedBrowser,
        'Este navegador no permite acceder a cámara ni micrófono (¿se abrió sin HTTPS?).',
      );
    }
    return devices;
  }

  async list(): Promise<DeviceInfo[]> {
    const all = await this.devices.enumerateDevices();
    const counters: Record<DeviceKind, number> = { videoinput: 0, audioinput: 0, audiooutput: 0 };
    return all
      .filter((d): d is MediaDeviceInfo & { kind: DeviceKind } => d.kind in counters)
      .filter((d) => d.deviceId !== '')
      .map((d) => {
        counters[d.kind] += 1;
        return {
          id: d.deviceId,
          kind: d.kind,
          // Labels stay empty until the user grants permission.
          label: d.label || `${KIND_LABELS[d.kind]} ${counters[d.kind]}`,
        };
      });
  }

  async camera(constraints: Record<string, unknown>): Promise<MediaTrackLike> {
    const track = await this.single({ video: constraints as MediaTrackConstraints }, 'video');
    (track as MediaStreamTrack).contentHint = 'motion';
    return track;
  }

  async microphone(constraints: Record<string, unknown>): Promise<MediaTrackLike> {
    return this.single({ audio: constraints as MediaTrackConstraints }, 'audio');
  }

  async screen(options: {
    readonly framerate: number;
    readonly withAudio: boolean;
  }): Promise<ScreenCapture> {
    let stream: MediaStream;
    try {
      stream = await this.devices.getDisplayMedia({
        video: {
          frameRate: { ideal: options.framerate },
          width: { max: 3840 },
          height: { max: 2160 },
        },
        audio: options.withAudio
          ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
          : false,
        // Chromium hints; ignored elsewhere.
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        systemAudio: options.withAudio ? 'include' : 'exclude',
        monitorTypeSurfaces: 'include',
      } as DisplayMediaStreamOptions);
    } catch (error) {
      throw toCaptureError(error, 'screen');
    }
    const [video] = stream.getVideoTracks();
    if (!video) throw new RelayError(RelayErrorCode.NoSources, 'No se compartió ninguna pantalla.');
    video.contentHint = 'detail';
    const [audio] = stream.getAudioTracks();
    return { video, ...(audio ? { audio } : {}) };
  }

  onDeviceChange(listener: () => void): () => void {
    const devices = globalThis.navigator?.mediaDevices;
    devices?.addEventListener('devicechange', listener);
    return () => devices?.removeEventListener('devicechange', listener);
  }

  private async single(
    constraints: MediaStreamConstraints,
    kind: 'audio' | 'video',
  ): Promise<MediaTrackLike> {
    let stream: MediaStream;
    try {
      stream = await this.devices.getUserMedia(constraints);
    } catch (error) {
      throw toCaptureError(error, kind === 'video' ? 'camera' : 'microphone');
    }
    const track = kind === 'video' ? stream.getVideoTracks()[0] : stream.getAudioTracks()[0];
    if (!track) throw new RelayError(RelayErrorCode.NoSources, 'El dispositivo no entregó señal.');
    return track;
  }
}

const SOURCE_LABELS = { camera: 'la cámara', microphone: 'el micrófono', screen: 'la pantalla' };

/** Maps getUserMedia/getDisplayMedia DOMExceptions to user-facing errors. */
export function toCaptureError(
  error: unknown,
  source: keyof typeof SOURCE_LABELS = 'camera',
): RelayError {
  if (error instanceof RelayError) return error;
  const name = (error as { name?: string } | undefined)?.name;
  const what = SOURCE_LABELS[source];
  const message =
    name === 'NotAllowedError'
      ? `Se denegó el permiso para usar ${what}.`
      : name === 'NotFoundError' || name === 'OverconstrainedError'
        ? `No se encontró ${what} o no admite esta configuración.`
        : name === 'NotReadableError'
          ? `${what[0]?.toUpperCase()}${what.slice(1)} está en uso por otra aplicación.`
          : `Falló el acceso a ${what}: ${(error as Error | undefined)?.message ?? 'error desconocido'}`;
  return new RelayError(RelayErrorCode.CaptureDenied, message, { cause: error });
}
