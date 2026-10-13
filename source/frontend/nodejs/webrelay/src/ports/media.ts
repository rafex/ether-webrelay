/**
 * Structural subset of a browser MediaStreamTrack. The application layer only
 * needs these members, so it stays testable in Node; real tracks satisfy it as is.
 */
export interface MediaTrackLike {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  enabled: boolean;
  readonly readyState: string;
  stop(): void;
  getSettings(): { readonly width?: number; readonly height?: number; readonly deviceId?: string };
  addEventListener(type: 'ended', listener: () => void): void;
  removeEventListener(type: 'ended', listener: () => void): void;
}

export type DeviceKind = 'audioinput' | 'videoinput' | 'audiooutput';

export interface DeviceInfo {
  readonly id: string;
  readonly kind: DeviceKind;
  readonly label: string;
}

export interface ScreenCapture {
  readonly video: MediaTrackLike;
  /** Tab/system audio, when the browser and the user's choice provide it. */
  readonly audio?: MediaTrackLike;
}

/** Driven port over getUserMedia/getDisplayMedia/enumerateDevices. */
export interface MediaDevicesPort {
  list(): Promise<DeviceInfo[]>;
  camera(constraints: Record<string, unknown>): Promise<MediaTrackLike>;
  microphone(constraints: Record<string, unknown>): Promise<MediaTrackLike>;
  screen(options: {
    readonly framerate: number;
    readonly withAudio: boolean;
  }): Promise<ScreenCapture>;
  /** Returns an unsubscribe function. */
  onDeviceChange(listener: () => void): () => void;
}
