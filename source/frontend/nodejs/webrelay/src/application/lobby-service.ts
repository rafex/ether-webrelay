import { RelayError, RelayErrorCode } from '../domain/errors';
import type { Invite } from '../domain/invite';
import type { UserPreferences } from '../domain/preferences';
import {
  cameraConstraints,
  microphoneConstraints,
  type QualityProfile,
} from '../domain/quality-profile';
import type { RoomInfo } from '../domain/signaling';
import { type AudioEnhancerPort, passthroughAudio } from '../ports/audio-enhancer';
import type { DeviceInfo, MediaDevicesPort, MediaTrackLike } from '../ports/media';
import type { PreferencesPort } from '../ports/preferences';
import { passthroughEffects, type VideoEffectsPort } from '../ports/video-effects';
import type { LocalMediaProvider, LocalTrackHandle, ScreenHandles } from './call-controller';
import type { SignalingClient, SignalingState } from './signaling-client';

export type LobbyPhase = 'connecting' | 'ready' | 'rejected' | 'unreachable';

export interface LobbySnapshot {
  readonly phase: LobbyPhase;
  readonly signaling: SignalingState;
  readonly room?: RoomInfo;
  readonly error?: string;
  readonly devices: readonly DeviceInfo[];
  readonly preferences: UserPreferences;
  readonly camera?: MediaTrackLike;
  readonly microphone?: MediaTrackLike;
  /** Problem opening the camera or microphone (permission denied, device busy…). */
  readonly mediaError?: string;
}

export interface LobbyServiceDeps {
  readonly invite: Invite;
  readonly client: SignalingClient;
  readonly devices: MediaDevicesPort;
  readonly preferences: PreferencesPort;
  readonly profile: QualityProfile;
  readonly effects?: VideoEffectsPort;
  readonly audioEnhancer?: AudioEnhancerPort;
}

const CAMERA_KEYS: readonly (keyof UserPreferences)[] = ['cameraId', 'resolution', 'effect'];
const MICROPHONE_KEYS: readonly (keyof UserPreferences)[] = ['microphoneId', 'audio'];

/**
 * Pre-join room: validates the invitation with the bridge (`room.peek`), shows
 * a local preview and keeps device/identity preferences. It is also the
 * LocalMediaProvider the call uses, so in-call changes honour the same choices.
 */
export class LobbyService implements LocalMediaProvider {
  private phase: LobbyPhase = 'connecting';
  private room: RoomInfo | undefined;
  private error: string | undefined;
  private cameraError: string | undefined;
  private microphoneError: string | undefined;
  private devices: readonly DeviceInfo[] = [];
  private prefs: UserPreferences;
  private camera: LocalTrackHandle | undefined;
  private microphone: LocalTrackHandle | undefined;
  /** False once the preview has been handed to the call. */
  private previewActive = true;
  private readonly unsubscribers: (() => void)[] = [];
  private readonly listeners = new Set<(snapshot: LobbySnapshot) => void>();
  private readonly effects: VideoEffectsPort;
  private readonly audioEnhancer: AudioEnhancerPort;

  constructor(private readonly deps: LobbyServiceDeps) {
    this.prefs = deps.preferences.load();
    this.effects = deps.effects ?? passthroughEffects;
    this.audioEnhancer = deps.audioEnhancer ?? passthroughAudio;
  }

  get snapshot(): LobbySnapshot {
    const mediaError = this.cameraError ?? this.microphoneError;
    return {
      phase: this.phase,
      signaling: this.deps.client.currentState,
      ...(this.room ? { room: this.room } : {}),
      ...(this.error ? { error: this.error } : {}),
      devices: this.devices,
      preferences: this.prefs,
      ...(this.camera ? { camera: this.camera.track } : {}),
      ...(this.microphone ? { microphone: this.microphone.track } : {}),
      ...(mediaError ? { mediaError } : {}),
    };
  }

  get preferences(): UserPreferences {
    return this.prefs;
  }

  subscribe(listener: (snapshot: LobbySnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    const { client } = this.deps;
    this.unsubscribers.push(
      client.onMessage((message) => {
        if (message.type === 'room.info' && this.phase !== 'rejected') {
          this.room = { ...message };
          this.phase = 'ready';
          this.emit();
        }
      }),
      client.onReconnected(() => this.peek()),
      client.onStateChange(() => this.emit()),
      client.onFailed((error) => {
        this.phase = error.code === RelayErrorCode.BridgeRejected ? 'rejected' : 'unreachable';
        this.error = error.message;
        this.emit();
      }),
      this.deps.devices.onDeviceChange(() => void this.refreshDevices()),
    );
    const connected = client.open().then(
      () => this.peek(),
      () => undefined, // reported through onFailed
    );
    await Promise.all([connected, this.openPreview()]);
  }

  // ---------------------------------------------------------------- toggles

  async setCameraEnabled(enabled: boolean): Promise<void> {
    this.patch({ cameraEnabled: enabled });
    if (!this.previewActive) return;
    if (enabled) await this.reopenCamera();
    else this.releaseCamera();
    this.emit();
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    this.patch({ microphoneEnabled: enabled });
    if (!this.previewActive) return;
    if (enabled) await this.reopenMicrophone();
    else this.releaseMicrophone();
    this.emit();
  }

  /**
   * Updates preferences; while the preview is live, affected tracks are reopened.
   * During the call the UI reopens through openCamera/openMicrophone instead.
   */
  async updatePreferences(patch: Partial<UserPreferences>): Promise<void> {
    this.patch(patch);
    if (this.previewActive) {
      const keys = Object.keys(patch) as (keyof UserPreferences)[];
      const reopen: Promise<void>[] = [];
      if (this.prefs.cameraEnabled && keys.some((k) => CAMERA_KEYS.includes(k))) {
        reopen.push(this.reopenCamera());
      }
      if (this.prefs.microphoneEnabled && keys.some((k) => MICROPHONE_KEYS.includes(k))) {
        reopen.push(this.reopenMicrophone());
      }
      await Promise.all(reopen);
    }
    this.emit();
  }

  /** Hands the preview tracks to the call; the lobby stops managing them. */
  takePreview(): { camera?: LocalTrackHandle; microphone?: LocalTrackHandle } {
    this.previewActive = false;
    const handles = {
      ...(this.camera ? { camera: this.camera } : {}),
      ...(this.microphone ? { microphone: this.microphone } : {}),
    };
    this.camera = undefined;
    this.microphone = undefined;
    this.emit();
    return handles;
  }

  /** Re-arms the preview (back in the lobby after leaving). */
  async resumePreview(): Promise<void> {
    this.previewActive = true;
    await this.openPreview();
  }

  dispose(): void {
    this.releaseCamera();
    this.releaseMicrophone();
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.listeners.clear();
  }

  // ------------------------------------------------- LocalMediaProvider

  async openCamera(): Promise<LocalTrackHandle> {
    const raw = await this.deps.devices.camera(
      cameraConstraints(this.prefs.resolution, this.deps.profile, this.prefs.cameraId),
    );
    try {
      const processed = await this.effects.apply(raw, this.prefs.effect);
      return {
        track: processed.track,
        stop: () => {
          processed.stop();
          raw.stop();
        },
      };
    } catch (error) {
      raw.stop();
      throw error;
    }
  }

  async openMicrophone(): Promise<LocalTrackHandle> {
    const { audio, microphoneId } = this.prefs;
    const raw = await this.deps.devices.microphone(microphoneConstraints(audio, microphoneId));
    if (!audio.rnnoise && !audio.leveler) return { track: raw, stop: () => raw.stop() };

    const processed = await this.audioEnhancer.apply(raw, {
      rnnoise: audio.rnnoise,
      leveler: audio.leveler,
    });
    if (processed.track !== raw) {
      return {
        track: processed.track,
        stop: () => {
          processed.stop();
          raw.stop();
        },
      };
    }
    // Nothing could be applied. If RNNoise was meant to replace the browser's noise suppression,
    // the microphone was opened without it: open it again the usual way instead of leaving the
    // voice unprocessed.
    if (!audio.rnnoise) return { track: raw, stop: () => raw.stop() };
    raw.stop();
    const plain = await this.deps.devices.microphone(
      microphoneConstraints({ ...audio, rnnoise: false }, microphoneId),
    );
    return { track: plain, stop: () => plain.stop() };
  }

  async openScreen(options: { framerate: number; withAudio: boolean }): Promise<ScreenHandles> {
    const capture = await this.deps.devices.screen(options);
    const { video, audio } = capture;
    return {
      video: { track: video, stop: () => video.stop() },
      ...(audio ? { audio: { track: audio, stop: () => audio.stop() } } : {}),
    };
  }

  // -------------------------------------------------------------- internals

  private peek(): void {
    if (this.phase === 'rejected') return;
    this.deps.client.send({
      type: 'room.peek',
      room: this.deps.invite.room,
      token: this.deps.invite.token,
    });
  }

  /**
   * Each device is shown as soon as it opens: a pending microphone permission
   * prompt must not keep the camera preview (or the device list) waiting.
   */
  private async openPreview(): Promise<void> {
    const open = (enabled: boolean, reopen: () => Promise<void>) =>
      enabled
        ? reopen().then(async () => {
            // Device labels are only exposed after a permission grant.
            await this.refreshDevices();
          })
        : Promise.resolve();
    await Promise.all([
      open(this.prefs.cameraEnabled, () => this.reopenCamera()),
      open(this.prefs.microphoneEnabled, () => this.reopenMicrophone()),
    ]);
    await this.refreshDevices();
  }

  private async reopenCamera(): Promise<void> {
    this.releaseCamera();
    try {
      this.camera = await this.openCamera();
      this.cameraError = undefined;
    } catch (error) {
      this.cameraError = describe(error);
    }
    this.emit();
  }

  private async reopenMicrophone(): Promise<void> {
    this.releaseMicrophone();
    try {
      this.microphone = await this.openMicrophone();
      this.microphoneError = undefined;
    } catch (error) {
      this.microphoneError = describe(error);
    }
    this.emit();
  }

  private releaseCamera(): void {
    this.cameraError = undefined;
    this.camera?.stop();
    this.camera = undefined;
  }

  private releaseMicrophone(): void {
    this.microphoneError = undefined;
    this.microphone?.stop();
    this.microphone = undefined;
  }

  private async refreshDevices(): Promise<void> {
    try {
      this.devices = await this.deps.devices.list();
    } catch {
      this.devices = [];
    }
    this.emit();
  }

  private patch(patch: Partial<UserPreferences>): void {
    this.prefs = { ...this.prefs, ...patch };
    this.deps.preferences.save(this.prefs);
  }

  private emit(): void {
    const snapshot = this.snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

function describe(error: unknown): string {
  return error instanceof RelayError
    ? error.message
    : `No se pudo abrir el dispositivo: ${String(error)}`;
}
