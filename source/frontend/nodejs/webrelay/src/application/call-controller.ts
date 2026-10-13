import type { CallStats } from '../domain/call-stats';
import type { RelayError } from '../domain/errors';
import type { QualityProfile } from '../domain/quality-profile';
import type { RoomState } from '../domain/room';
import type { SelfState, TransportMode } from '../domain/signaling';
import type { MediaTrackLike } from '../ports/media';

/** A local track plus how to release everything behind it (device, effect pipeline). */
export interface LocalTrackHandle {
  readonly track: MediaTrackLike;
  stop(): void;
}

export interface ScreenHandles {
  readonly video: LocalTrackHandle;
  readonly audio?: LocalTrackHandle;
}

/** Opens local media with the participant's current preferences (devices, effects, quality). */
export interface LocalMediaProvider {
  openCamera(): Promise<LocalTrackHandle>;
  openMicrophone(): Promise<LocalTrackHandle>;
  openScreen(options: {
    readonly framerate: number;
    readonly withAudio: boolean;
  }): Promise<ScreenHandles>;
}

export type CallState = 'joining' | 'connected' | 'reconnecting' | 'left' | 'failed';

export interface ParticipantMedia {
  readonly camera?: MediaTrackLike;
  readonly microphone?: MediaTrackLike;
  readonly screen?: MediaTrackLike;
  readonly screenAudio?: MediaTrackLike;
}

export interface LocalMedia {
  readonly camera?: MediaTrackLike;
  readonly microphone?: MediaTrackLike;
  readonly screen?: MediaTrackLike;
}

export interface CallSnapshot {
  readonly mode: TransportMode;
  readonly state: CallState;
  readonly self: SelfState;
  readonly local: LocalMedia;
  readonly room: RoomState;
  /** Remote media by participant id (empty in `websocket` mode). */
  readonly remote: ReadonlyMap<string, ParticipantMedia>;
  readonly stats: CallStats | undefined;
  readonly profile: QualityProfile;
  readonly error?: RelayError;
}

/** What the call UI drives, independent of the transport (WebRTC or WebSocket). */
export interface CallController {
  readonly snapshot: CallSnapshot;
  /** Resolves once the bridge has admitted the participant. */
  join(): Promise<void>;
  setMicrophoneEnabled(enabled: boolean): Promise<void>;
  setCameraEnabled(enabled: boolean): Promise<void>;
  startScreenShare(): Promise<void>;
  stopScreenShare(): Promise<void>;
  /** Swaps the camera (device change, new effect, new resolution). Takes ownership. */
  replaceCamera(handle: LocalTrackHandle): Promise<void>;
  replaceMicrophone(handle: LocalTrackHandle): Promise<void>;
  leave(): Promise<void>;
  subscribe(listener: (snapshot: CallSnapshot) => void): () => void;
}

export const SOURCE_KEYS = {
  camera: 'camera',
  microphone: 'microphone',
  screen: 'screen',
  'screen-audio': 'screenAudio',
} as const satisfies Record<string, keyof ParticipantMedia>;
