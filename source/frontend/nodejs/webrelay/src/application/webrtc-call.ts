import { type CallStats, summarizeStats } from '../domain/call-stats';
import { RelayError, RelayErrorCode } from '../domain/errors';
import type { TimeSource } from '../domain/media-clock';
import {
  cameraEncoding,
  type QualityProfile,
  type ResolutionChoice,
  screenEncoding,
} from '../domain/quality-profile';
import { EMPTY_ROOM, type RoomState, reduceRoom } from '../domain/room';
import type {
  IceCandidateData,
  IceServerConfig,
  MediaSource,
  PeerRole,
  SelfState,
  ServerMessage,
} from '../domain/signaling';
import type { MediaTrackLike } from '../ports/media';
import type {
  PeerConnectionFactory,
  PeerConnectionLike,
  PeerSender,
} from '../ports/peer-connection';
import type { Timer, TimerHandle } from '../ports/time';
import {
  type CallController,
  type CallSnapshot,
  type CallState,
  type LocalMediaProvider,
  type LocalTrackHandle,
  type ParticipantMedia,
  SOURCE_KEYS,
} from './call-controller';
import type { SignalingClient } from './signaling-client';

export interface WebRtcCallDeps {
  readonly client: SignalingClient;
  readonly peers: PeerConnectionFactory;
  readonly media: LocalMediaProvider;
  readonly timer: Timer;
  readonly time: TimeSource;
  readonly identity: { readonly name: string; readonly title?: string };
  readonly initial: { readonly camera?: LocalTrackHandle; readonly microphone?: LocalTrackHandle };
  readonly microphoneEnabled: boolean;
  readonly defaultProfile: QualityProfile;
  readonly resolution: ResolutionChoice;
  readonly statsIntervalMs?: number;
}

type LocalSlot = 'camera' | 'microphone' | 'screen' | 'screenAudio';

const SLOT_SOURCES: Record<LocalSlot, MediaSource> = {
  camera: 'camera',
  microphone: 'microphone',
  screen: 'screen',
  screenAudio: 'screen-audio',
};

/**
 * WebRTC call against the bridge's SFU, negotiated over signaling v2:
 * one `publish` connection (we offer our tracks) and one `subscribe`
 * connection (the bridge offers everybody else's). Muting keeps the sender;
 * turning the camera off or stopping a share swaps the track for null, so
 * toggles never renegotiate once a transceiver exists.
 */
export class WebRtcCallSession implements CallController {
  private state: CallState = 'joining';
  private room: RoomState = EMPTY_ROOM;
  /** Proves ownership of `room.self` when the signaling socket is re-established. */
  private resumeToken: string | undefined;
  private profile: QualityProfile;
  private iceServers: readonly IceServerConfig[] = [];
  private publishPc: PeerConnectionLike | undefined;
  private subscribePc: PeerConnectionLike | undefined;
  private readonly remoteSet: Record<PeerRole, boolean> = { publish: false, subscribe: false };
  private readonly pendingIce: Record<PeerRole, IceCandidateData[]> = {
    publish: [],
    subscribe: [],
  };
  private readonly senders: Partial<Record<LocalSlot, PeerSender>> = {};
  private readonly local: Partial<Record<LocalSlot, LocalTrackHandle>> = {};
  private readonly remoteTracks = new Map<string, MediaTrackLike>();
  private self: SelfState;
  private negotiating = false;
  private renegotiate = false;
  private stats: CallStats | undefined;
  private statsTimer: TimerHandle | undefined;
  private error: RelayError | undefined;
  private admitted: { resolve: () => void; reject: (error: Error) => void } | undefined;
  /** Signaling messages are handled strictly in arrival order. */
  private inbox: Promise<void> = Promise.resolve();
  private readonly unsubscribers: (() => void)[] = [];
  private readonly listeners = new Set<(snapshot: CallSnapshot) => void>();

  constructor(private readonly deps: WebRtcCallDeps) {
    this.profile = deps.defaultProfile;
    if (deps.initial.camera) this.local.camera = deps.initial.camera;
    if (deps.initial.microphone) {
      this.local.microphone = deps.initial.microphone;
      deps.initial.microphone.track.enabled = deps.microphoneEnabled;
    }
    this.self = {
      muted: !deps.microphoneEnabled || !deps.initial.microphone,
      cameraOff: !deps.initial.camera,
      screenSharing: false,
    };
  }

  get snapshot(): CallSnapshot {
    return {
      mode: 'webrtc',
      state: this.state,
      self: this.self,
      local: {
        ...(this.local.camera ? { camera: this.local.camera.track } : {}),
        ...(this.local.microphone ? { microphone: this.local.microphone.track } : {}),
        ...(this.local.screen ? { screen: this.local.screen.track } : {}),
      },
      room: this.room,
      remote: this.remoteMedia(),
      stats: this.stats,
      profile: this.profile,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  subscribe(listener: (snapshot: CallSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  join(): Promise<void> {
    const { client } = this.deps;
    const admitted = new Promise<void>((resolve, reject) => {
      this.admitted = { resolve, reject };
    });
    this.unsubscribers.push(
      client.onMessage((message) => {
        this.inbox = this.inbox.then(() => this.handle(message));
      }),
      client.onReconnected(() => this.sendJoin(this.room.self)),
      client.onStateChange((state) => {
        if (state === 'reconnecting' && this.state === 'connected') this.setState('reconnecting');
      }),
      client.onFailed((error) => this.fail(error)),
    );
    this.sendJoin(undefined);
    return admitted;
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (enabled && !this.local.microphone) {
      await this.attach('microphone', await this.deps.media.openMicrophone());
    }
    if (this.local.microphone) this.local.microphone.track.enabled = enabled;
    this.updateSelf({ muted: !enabled });
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      if (!this.local.camera) await this.attach('camera', await this.deps.media.openCamera());
    } else {
      await this.detach('camera');
    }
    this.updateSelf({ cameraOff: !enabled });
  }

  async startScreenShare(): Promise<void> {
    if (this.self.screenSharing) return;
    const capture = await this.deps.media.openScreen({
      framerate: this.profile.screenFramerate,
      withAudio: true,
    });
    capture.video.track.addEventListener('ended', () => void this.stopScreenShare());
    // Video and tab audio go out in a single negotiation.
    const addedVideo = await this.attach('screen', capture.video, false);
    const addedAudio = capture.audio
      ? await this.attach('screenAudio', capture.audio, false)
      : false;
    if (addedVideo || addedAudio) await this.negotiate();
    this.updateSelf({ screenSharing: true });
  }

  async stopScreenShare(): Promise<void> {
    if (!this.self.screenSharing) return;
    await this.detach('screen');
    await this.detach('screenAudio');
    this.updateSelf({ screenSharing: false });
  }

  async replaceCamera(handle: LocalTrackHandle): Promise<void> {
    if (this.self.cameraOff) {
      handle.stop();
      return;
    }
    await this.attach('camera', handle);
  }

  async replaceMicrophone(handle: LocalTrackHandle): Promise<void> {
    handle.track.enabled = !this.self.muted;
    await this.attach('microphone', handle);
  }

  async leave(): Promise<void> {
    if (this.state === 'left' || this.state === 'failed') return;
    this.deps.client.send({ type: 'leave' });
    this.cleanup();
    this.deps.client.close('leave');
    this.setState('left');
  }

  // ------------------------------------------------------------- signaling

  private sendJoin(resume: string | undefined, admit?: string): void {
    this.deps.client.send({
      type: 'join',
      name: this.deps.identity.name,
      ...(this.deps.identity.title ? { title: this.deps.identity.title } : {}),
      media: { audio: Boolean(this.local.microphone), video: Boolean(this.local.camera) },
      // The id alone is public; the bridge only resumes it when the secret matches.
      ...(resume ? { resume, ...(this.resumeToken ? { resumeToken: this.resumeToken } : {}) } : {}),
      // One-time key the host's approval gave this socket (see `admitted`).
      ...(admit ? { admit } : {}),
    });
  }

  private async handle(message: ServerMessage): Promise<void> {
    if (this.state === 'left' || this.state === 'failed') return;
    try {
      switch (message.type) {
        case 'welcome':
          await this.onWelcome(message);
          break;
        case 'waiting':
          // No seat yet: nothing to publish or subscribe until the host admits us.
          this.setState('waiting');
          break;
        case 'admitted':
          this.sendJoin(undefined, message.token);
          break;
        case 'publish.answer':
          await this.publishPc?.acceptAnswer(message.sdp);
          this.remoteSet.publish = true;
          await this.flushIce('publish');
          this.negotiating = false;
          if (this.renegotiate) {
            this.renegotiate = false;
            await this.negotiate();
          }
          break;
        case 'subscribe.offer': {
          const pc = this.ensureSubscribePc();
          const answer = await pc.acceptOffer(message.sdp);
          this.remoteSet.subscribe = true;
          await this.flushIce('subscribe');
          this.deps.client.send({ type: 'subscribe.answer', sdp: answer });
          break;
        }
        case 'ice':
          await this.addIce(message.pc, message.candidate);
          break;
        case 'profile':
          this.profile = message.profile;
          await this.applyEncodings();
          this.emit();
          break;
        case 'tracks':
        case 'participant.joined':
        case 'participant.updated':
        case 'participant.left':
          this.room = reduceRoom(this.room, message);
          this.emit();
          break;
        default:
          break;
      }
    } catch (error) {
      this.fail(
        new RelayError(
          RelayErrorCode.Protocol,
          `Falló la negociación de medios: ${(error as Error).message}`,
          { cause: error },
        ),
      );
    }
  }

  private async onWelcome(message: Extract<ServerMessage, { type: 'welcome' }>): Promise<void> {
    this.room = reduceRoom(this.room, message);
    this.resumeToken = message.resumeToken;
    this.profile = message.profile ?? this.deps.defaultProfile;
    this.iceServers = message.iceServers;
    if (!message.resumed || !this.publishPc) await this.setupPeers();
    this.setState('connected');
    this.startStats();
    this.deps.client.send({ type: 'self.update', ...this.self });
    this.admitted?.resolve();
    this.admitted = undefined;
  }

  // ---------------------------------------------------------- peer setup

  private async setupPeers(): Promise<void> {
    this.closePeers();
    const { client, peers } = this.deps;
    this.publishPc = peers.create(
      { iceServers: this.iceServers },
      {
        onIceCandidate: (candidate) => client.send({ type: 'ice', pc: 'publish', candidate }),
        onTrack: () => undefined,
        onConnectionStateChange: (state) => {
          if (state === 'failed') void this.negotiate({ iceRestart: true });
        },
      },
    );
    for (const slot of ['camera', 'microphone', 'screen', 'screenAudio'] as const) {
      const handle = this.local[slot];
      if (handle)
        this.senders[slot] = this.publishPc.addSender(handle.track, this.encodingFor(slot, handle));
    }
    this.ensureSubscribePc();
    await this.negotiate();
  }

  private ensureSubscribePc(): PeerConnectionLike {
    if (this.subscribePc) return this.subscribePc;
    this.subscribePc = this.deps.peers.create(
      { iceServers: this.iceServers },
      {
        onIceCandidate: (candidate) =>
          this.deps.client.send({ type: 'ice', pc: 'subscribe', candidate }),
        onTrack: ({ mid, track }) => {
          if (mid === null) return;
          this.remoteTracks.set(mid, track);
          track.addEventListener('ended', () => {
            if (this.remoteTracks.get(mid) === track) this.remoteTracks.delete(mid);
            this.emit();
          });
          this.emit();
        },
        onConnectionStateChange: () => undefined,
      },
    );
    return this.subscribePc;
  }

  /**
   * Serialized publish negotiation: overlapping requests collapse into one follow-up.
   * Nothing is offered until there is at least one track (an offer without media
   * sections is invalid with max-bundle); a participant may join just to watch.
   */
  private async negotiate(options: { iceRestart?: boolean } = {}): Promise<void> {
    if (!this.publishPc || Object.keys(this.senders).length === 0) return;
    if (this.negotiating) {
      this.renegotiate = true;
      return;
    }
    this.negotiating = true;
    const sdp = await this.publishPc.createOffer(options);
    this.deps.client.send({ type: 'publish.offer', sdp, sources: this.publishedSources() });
  }

  private publishedSources(): Record<string, MediaSource> {
    const sources: Record<string, MediaSource> = {};
    for (const [slot, sender] of Object.entries(this.senders) as [LocalSlot, PeerSender][]) {
      if (sender.mid !== null) sources[sender.mid] = SLOT_SOURCES[slot];
    }
    return sources;
  }

  private async addIce(role: PeerRole, candidate: IceCandidateData): Promise<void> {
    const pc = role === 'publish' ? this.publishPc : this.subscribePc;
    if (!pc || !this.remoteSet[role]) {
      this.pendingIce[role].push(candidate);
      return;
    }
    await pc.addIceCandidate(candidate);
  }

  private async flushIce(role: PeerRole): Promise<void> {
    const pc = role === 'publish' ? this.publishPc : this.subscribePc;
    const queued = this.pendingIce[role].splice(0);
    for (const candidate of queued) await pc?.addIceCandidate(candidate);
  }

  // ---------------------------------------------------------- local media

  /**
   * Puts `handle` in `slot`, reusing the transceiver when there is one.
   * Returns true when a new transceiver was added (needs negotiation).
   */
  private async attach(
    slot: LocalSlot,
    handle: LocalTrackHandle,
    negotiateNow = true,
  ): Promise<boolean> {
    const previous = this.local[slot];
    this.local[slot] = handle;
    const sender = this.senders[slot];
    let added = false;
    if (sender) {
      await sender.replaceTrack(handle.track);
      const encoding = this.encodingFor(slot, handle);
      if (encoding) await sender.setEncoding(encoding);
    } else if (this.publishPc) {
      this.senders[slot] = this.publishPc.addSender(handle.track, this.encodingFor(slot, handle));
      added = true;
      if (negotiateNow) await this.negotiate();
    }
    if (previous && previous !== handle) previous.stop();
    this.emit();
    return added;
  }

  private async detach(slot: LocalSlot): Promise<void> {
    const handle = this.local[slot];
    if (!handle) return;
    delete this.local[slot];
    await this.senders[slot]?.replaceTrack(null);
    handle.stop();
    this.emit();
  }

  private encodingFor(slot: LocalSlot, handle: LocalTrackHandle) {
    const settings = handle.track.getSettings();
    const size = { width: settings.width ?? 0, height: settings.height ?? 0 };
    if (slot === 'camera') return cameraEncoding(this.profile, this.deps.resolution, size);
    if (slot === 'screen') return screenEncoding(this.profile, size);
    return undefined;
  }

  private async applyEncodings(): Promise<void> {
    for (const slot of ['camera', 'screen'] as const) {
      const handle = this.local[slot];
      const encoding = handle ? this.encodingFor(slot, handle) : undefined;
      if (encoding) await this.senders[slot]?.setEncoding(encoding);
    }
  }

  private updateSelf(patch: Partial<SelfState>): void {
    this.self = { ...this.self, ...patch };
    this.deps.client.send({ type: 'self.update', ...this.self });
    this.emit();
  }

  // ----------------------------------------------------------------- misc

  private remoteMedia(): Map<string, ParticipantMedia> {
    const media = new Map<string, Record<string, MediaTrackLike>>();
    for (const [mid, info] of Object.entries(this.room.tracks)) {
      const track = this.remoteTracks.get(mid);
      if (!track) continue;
      const entry = media.get(info.participant) ?? {};
      entry[SOURCE_KEYS[info.source]] = track;
      media.set(info.participant, entry);
    }
    return media as Map<string, ParticipantMedia>;
  }

  private startStats(): void {
    if (this.statsTimer !== undefined) return;
    this.statsTimer = this.deps.timer.setInterval(
      () => void this.sampleStats(),
      this.deps.statsIntervalMs ?? 2_000,
    );
  }

  private async sampleStats(): Promise<void> {
    const records = [
      ...((await this.publishPc?.stats()) ?? []),
      ...((await this.subscribePc?.stats()) ?? []),
    ];
    this.stats = summarizeStats(records, this.deps.time.nowMs(), this.stats);
    this.emit();
  }

  private fail(error: RelayError): void {
    if (this.state === 'left' || this.state === 'failed') return;
    this.error = error;
    this.cleanup();
    this.deps.client.fail(error);
    this.setState('failed');
    this.admitted?.reject(error);
    this.admitted = undefined;
  }

  private cleanup(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    if (this.statsTimer !== undefined) this.deps.timer.clearInterval(this.statsTimer);
    this.statsTimer = undefined;
    this.closePeers();
    for (const slot of Object.keys(this.local) as LocalSlot[]) {
      this.local[slot]?.stop();
      delete this.local[slot];
    }
  }

  private closePeers(): void {
    this.publishPc?.close();
    this.subscribePc?.close();
    this.publishPc = undefined;
    this.subscribePc = undefined;
    this.remoteSet.publish = false;
    this.remoteSet.subscribe = false;
    this.pendingIce.publish = [];
    this.pendingIce.subscribe = [];
    this.negotiating = false;
    this.renegotiate = false;
    this.remoteTracks.clear();
    for (const slot of Object.keys(this.senders) as LocalSlot[]) delete this.senders[slot];
  }

  private setState(state: CallState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit();
  }

  private emit(): void {
    const snapshot = this.snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}
