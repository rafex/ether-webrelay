import type {
  LocalMediaProvider,
  LocalTrackHandle,
  ScreenHandles,
} from '../../src/application/call-controller';
import { RelayError } from '../../src/domain/errors';
import { DEFAULT_PREFERENCES, type UserPreferences } from '../../src/domain/preferences';
import type { SendEncoding } from '../../src/domain/quality-profile';
import type {
  ClientMessage,
  IceCandidateData,
  ParticipantInfo,
  ServerMessage,
} from '../../src/domain/signaling';
import type {
  DeviceInfo,
  MediaDevicesPort,
  MediaTrackLike,
  ScreenCapture,
} from '../../src/ports/media';
import type {
  ComposableMediaPipelinePort,
  MediaPipelineSink,
  PipelineSources,
} from '../../src/ports/media-pipeline';
import type {
  PeerConnectionFactory,
  PeerConnectionLike,
  PeerConnectionState,
  PeerHandlers,
  PeerSender,
  StatsRecord,
} from '../../src/ports/peer-connection';
import type { PreferencesPort } from '../../src/ports/preferences';
import type {
  SignalingConnection,
  SignalingHandlers,
  SignalingPort,
} from '../../src/ports/signaling';
import type { CloseInfo } from '../../src/ports/transport';

let trackCounter = 0;

export class FakeTrack implements MediaTrackLike {
  readonly id = `track-${++trackCounter}`;
  enabled = true;
  readyState = 'live';
  private readonly endedListeners = new Set<() => void>();

  constructor(
    readonly kind: 'audio' | 'video',
    readonly label: string = kind,
    private readonly settings: { width?: number; height?: number; deviceId?: string } = {},
  ) {}

  stop(): void {
    this.readyState = 'ended';
  }

  getSettings() {
    return this.settings;
  }

  addEventListener(_type: 'ended', listener: () => void): void {
    this.endedListeners.add(listener);
  }

  removeEventListener(_type: 'ended', listener: () => void): void {
    this.endedListeners.delete(listener);
  }

  /** Simulates the browser ending the track (user stopped sharing, device unplugged). */
  end(): void {
    this.readyState = 'ended';
    for (const listener of this.endedListeners) listener();
  }

  get stopped(): boolean {
    return this.readyState === 'ended';
  }
}

export function handle(track: FakeTrack): LocalTrackHandle {
  return { track, stop: () => track.stop() };
}

// --------------------------------------------------------------- signaling

export class FakeSignalingConnection implements SignalingConnection {
  readonly sent: ClientMessage[] = [];
  closed: { code?: number; reason?: string } | undefined;

  constructor(readonly handlers: SignalingHandlers) {}

  send(message: ClientMessage): void {
    if (this.closed) throw new Error('send on closed signaling connection');
    this.sent.push(message);
  }

  close(code?: number, reason?: string): void {
    this.closed = { ...(code !== undefined ? { code } : {}), ...(reason ? { reason } : {}) };
  }

  receive(message: ServerMessage): void {
    this.handlers.onMessage(message);
  }

  drop(info: CloseInfo = { code: 1006, reason: '', wasClean: false }): void {
    this.closed = { code: info.code };
    this.handlers.onClose(info);
  }

  ofType<T extends ClientMessage['type']>(type: T): Extract<ClientMessage, { type: T }>[] {
    return this.sent.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);
  }
}

export class FakeSignaling implements SignalingPort {
  readonly connections: FakeSignalingConnection[] = [];
  failNext = 0;

  async connect(_url: string, handlers: SignalingHandlers): Promise<SignalingConnection> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('connection refused');
    }
    const connection = new FakeSignalingConnection(handlers);
    this.connections.push(connection);
    return connection;
  }

  get last(): FakeSignalingConnection {
    const connection = this.connections.at(-1);
    if (!connection) throw new Error('no signaling connection yet');
    return connection;
  }
}

// ----------------------------------------------------------------- WebRTC

export class FakeSender implements PeerSender {
  readonly replaced: (MediaTrackLike | null)[] = [];
  readonly encodings: SendEncoding[] = [];

  constructor(
    public track: MediaTrackLike | null,
    readonly initialEncoding: SendEncoding | undefined,
  ) {}

  async replaceTrack(track: MediaTrackLike | null): Promise<void> {
    this.track = track;
    this.replaced.push(track);
  }

  async setEncoding(encoding: SendEncoding): Promise<void> {
    this.encodings.push(encoding);
  }
}

export class FakePeer implements PeerConnectionLike {
  readonly senders: FakeSender[] = [];
  readonly offers: string[] = [];
  readonly acceptedAnswers: string[] = [];
  readonly acceptedOffers: string[] = [];
  readonly candidates: IceCandidateData[] = [];
  statsRecords: StatsRecord[] = [];
  closed = false;
  failAcceptAnswer = false;

  constructor(
    readonly iceServers: readonly unknown[],
    readonly handlers: PeerHandlers,
  ) {}

  addSender(track: MediaTrackLike, encoding?: SendEncoding): PeerSender {
    const sender = new FakeSender(track, encoding);
    this.senders.push(sender);
    return sender;
  }

  async createOffer(options?: { iceRestart?: boolean }): Promise<string> {
    const sdp = `offer-${this.offers.length + 1}${options?.iceRestart ? '-restart' : ''}`;
    this.offers.push(sdp);
    return sdp;
  }

  async acceptAnswer(sdp: string): Promise<void> {
    if (this.failAcceptAnswer) throw new Error('bad answer');
    this.acceptedAnswers.push(sdp);
  }

  async acceptOffer(sdp: string): Promise<string> {
    this.acceptedOffers.push(sdp);
    return `answer-${this.acceptedOffers.length}`;
  }

  async addIceCandidate(candidate: IceCandidateData): Promise<void> {
    this.candidates.push(candidate);
  }

  async stats(): Promise<readonly StatsRecord[]> {
    return this.statsRecords;
  }

  close(): void {
    this.closed = true;
  }

  emitTrack(mid: string, track: MediaTrackLike): void {
    this.handlers.onTrack({ mid, track });
  }

  emitState(state: PeerConnectionState): void {
    this.handlers.onConnectionStateChange(state);
  }

  emitCandidate(candidate: string): void {
    this.handlers.onIceCandidate({ candidate, sdpMid: '0', sdpMLineIndex: 0 });
  }
}

export class FakePeerFactory implements PeerConnectionFactory {
  readonly created: FakePeer[] = [];

  create(config: { iceServers: readonly unknown[] }, handlers: PeerHandlers): PeerConnectionLike {
    const peer = new FakePeer(config.iceServers, handlers);
    this.created.push(peer);
    return peer;
  }

  /** Created in order publish, subscribe for each (re)setup. */
  get publish(): FakePeer {
    const peer = this.created.at(-2);
    if (!peer) throw new Error('no publish peer yet');
    return peer;
  }

  get subscribe(): FakePeer {
    const peer = this.created.at(-1);
    if (!peer) throw new Error('no subscribe peer yet');
    return peer;
  }
}

// ------------------------------------------------------------ local media

export class FakeMediaProvider implements LocalMediaProvider {
  readonly opened: FakeTrack[] = [];
  readonly screenTracks: { video: FakeTrack; audio: FakeTrack }[] = [];

  async openCamera(): Promise<LocalTrackHandle> {
    const track = new FakeTrack('video', 'cam', { width: 1280, height: 720 });
    this.opened.push(track);
    return handle(track);
  }

  async openMicrophone(): Promise<LocalTrackHandle> {
    const track = new FakeTrack('audio', 'mic');
    this.opened.push(track);
    return handle(track);
  }

  async openScreen(): Promise<ScreenHandles> {
    const video = new FakeTrack('video', 'screen', { width: 3840, height: 2160 });
    const audio = new FakeTrack('audio', 'screen-audio');
    this.screenTracks.push({ video, audio });
    return { video: handle(video), audio: handle(audio) };
  }
}

export class FakeDevices implements MediaDevicesPort {
  readonly cameraCalls: Record<string, unknown>[] = [];
  readonly microphoneCalls: Record<string, unknown>[] = [];
  readonly tracks: FakeTrack[] = [];
  denyCamera = false;
  devices: DeviceInfo[] = [
    { id: 'cam-1', kind: 'videoinput', label: 'Cámara de MacBook Air' },
    { id: 'mic-1', kind: 'audioinput', label: 'Micrófono de MacBook Air' },
    { id: 'spk-1', kind: 'audiooutput', label: 'Altavoces' },
  ];
  private changeListener: (() => void) | undefined;

  async list(): Promise<DeviceInfo[]> {
    return this.devices;
  }

  async camera(constraints: Record<string, unknown>): Promise<MediaTrackLike> {
    this.cameraCalls.push(constraints);
    if (this.denyCamera)
      throw new RelayError('capture-denied', 'Se denegó el permiso para usar la cámara.');
    const track = new FakeTrack('video', 'cam', { width: 1280, height: 720 });
    this.tracks.push(track);
    return track;
  }

  async microphone(constraints: Record<string, unknown>): Promise<MediaTrackLike> {
    this.microphoneCalls.push(constraints);
    const track = new FakeTrack('audio', 'mic');
    this.tracks.push(track);
    return track;
  }

  async screen(): Promise<ScreenCapture> {
    return { video: new FakeTrack('video', 'screen') };
  }

  onDeviceChange(listener: () => void): () => void {
    this.changeListener = listener;
    return () => {
      this.changeListener = undefined;
    };
  }

  plugIn(device: DeviceInfo): void {
    this.devices = [...this.devices, device];
    this.changeListener?.();
  }
}

export class MemoryPreferences implements PreferencesPort {
  saved: UserPreferences[] = [];

  constructor(private current: UserPreferences = DEFAULT_PREFERENCES) {}

  load(): UserPreferences {
    return this.current;
  }

  save(preferences: UserPreferences): void {
    this.current = preferences;
    this.saved.push(preferences);
  }
}

export class FakeComposablePipeline implements ComposableMediaPipelinePort {
  sink: MediaPipelineSink | undefined;
  readonly sourceHistory: PipelineSources[] = [];
  stopped = false;
  keyframeRequests = 0;

  constructor(public sources: PipelineSources) {}

  async start(sink: MediaPipelineSink): Promise<void> {
    this.sink = sink;
  }

  async setSources(sources: PipelineSources): Promise<void> {
    this.sources = sources;
    this.sourceHistory.push(sources);
  }

  requestKeyframe(): void {
    this.keyframeRequests++;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}

export function participant(
  id: string,
  name: string,
  extra: Partial<ParticipantInfo> = {},
): ParticipantInfo {
  return { id, name, muted: false, cameraOff: false, screenSharing: false, ...extra };
}
