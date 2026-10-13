import type { CallController, LocalTrackHandle } from '../application/call-controller';
import { LobbyService } from '../application/lobby-service';
import { SignalingClient } from '../application/signaling-client';
import { WebRtcCallSession } from '../application/webrtc-call';
import { WebSocketCallSession } from '../application/websocket-call';
import { type AppConfig, parseAppConfig } from '../domain/app-config';
import { INVITE_ERRORS, type Invite, parseInvite } from '../domain/invite';
import type { UserPreferences } from '../domain/preferences';
import { ReconnectPolicy } from '../domain/reconnect-policy';
import { relaySettingsFromProfile } from '../domain/relay-settings';
import { resolveShortcut, type ShortcutAction } from '../domain/shortcuts';
import type { TransportMode } from '../domain/signaling';
import { BrowserMediaPipeline } from '../infrastructure/browser-media-pipeline';
import { assertBrowserSupport } from '../infrastructure/browser-support';
import { BrowserMediaDevices } from '../infrastructure/devices/browser-media-devices';
import { WebSocketSignaling } from '../infrastructure/signaling/websocket-signaling';
import { LocalPreferences } from '../infrastructure/storage/local-preferences';
import { performanceTimeSource } from '../infrastructure/time/performance-time-source';
import { WebSocketTransport } from '../infrastructure/transport/websocket-transport';
import { browserPeerConnectionFactory } from '../infrastructure/webrtc/browser-peer-connection';
import { systemTimer } from '../ports/time';
import { passthroughEffects, type VideoEffectsPort } from '../ports/video-effects';
import { CallView } from './call-view';
import { byId, isEditable, showScreen, toast } from './dom';
import { LobbyView } from './lobby-view';
import { type SettingsContext, SettingsDialog, type SettingsSection } from './settings-dialog';

const CAMERA_KEYS: readonly (keyof UserPreferences)[] = ['cameraId', 'resolution', 'effect'];
const MICROPHONE_KEYS: readonly (keyof UserPreferences)[] = ['microphoneId', 'audio'];

/** Optional capabilities plugged in by main.ts (effects, recording). */
export interface AppExtensions {
  readonly effects?: VideoEffectsPort;
  readonly backgrounds?: SettingsContext['backgrounds'];
  /** Registers an uploaded image and returns its effect image id. */
  readonly uploadBackground?: (file: File) => Promise<string>;
  readonly effectsStatus?: () => string;
  /** Local recording of the call; the returned toggle resolves to "recording now". */
  readonly recorder?: (call: CallController, title: string) => () => Promise<boolean>;
}

type Identity = { name: string; title?: string };
type Handles = { camera?: LocalTrackHandle; microphone?: LocalTrackHandle };

/**
 * Driving adapter: config.json + invitation link → lobby → call → "left".
 * Media never touches RTMPS; the bridge behind `bridgeUrl` does.
 */
export class WebRelayApp {
  private config: AppConfig | undefined;
  private lobby: LobbyService | undefined;
  private lobbyView: LobbyView | undefined;
  private call: CallController | undefined;
  private callView: CallView | undefined;
  private settings: SettingsDialog | undefined;

  constructor(private readonly extensions: AppExtensions = {}) {}

  async start(): Promise<void> {
    showScreen('loading');
    byId('rejoin').addEventListener('click', () => location.reload());
    document.addEventListener('keydown', (event) => this.onKey(event));

    const invite = parseInvite(location.pathname, location.search);
    if (!invite.ok) return this.invalid(INVITE_ERRORS[invite.reason]);

    const config = await loadConfig();
    if (!config.ok) return this.invalid(config.message);
    this.config = config.config;

    try {
      assertBrowserSupport(this.config.transport);
    } catch (error) {
      return this.invalid((error as Error).message);
    }
    await this.openLobby(invite.invite);
  }

  // -------------------------------------------------------------- lobby

  private async openLobby(invite: Invite): Promise<void> {
    const config = this.requireConfig();
    const client = new SignalingClient({
      url: config.bridgeUrl,
      signaling: new WebSocketSignaling(),
      reconnectPolicy: new ReconnectPolicy(),
      timer: systemTimer,
      time: performanceTimeSource,
    });
    const lobby = new LobbyService({
      invite,
      client,
      devices: new BrowserMediaDevices(),
      preferences: new LocalPreferences(),
      profile: config.defaultProfile,
      effects: this.extensions.effects ?? passthroughEffects,
    });
    this.lobby = lobby;
    this.settings = new SettingsDialog(this.settingsContext());
    lobby.subscribe(() => this.settings?.refresh());
    this.lobbyView = new LobbyView(lobby, {
      openSettings: (section) => this.settings?.open(section as SettingsSection),
      join: (identity) => void this.join(invite, client, identity),
    });
    showScreen('lobby');
    byId('join-name').focus();
    await lobby.start();
  }

  // --------------------------------------------------------------- call

  private async join(invite: Invite, client: SignalingClient, identity: Identity): Promise<void> {
    const lobby = this.requireLobby();
    const config = this.requireConfig();
    await lobby.updatePreferences({ name: identity.name, title: identity.title ?? '' });
    const transport: TransportMode = lobby.snapshot.room?.transport ?? config.transport;
    const prefs = lobby.preferences;
    const title = lobby.snapshot.room?.title ?? invite.room;
    const initial = lobby.takePreview();
    this.lobbyView?.dispose();
    this.lobbyView = undefined;

    const call =
      transport === 'webrtc'
        ? this.webrtcCall(client, lobby, identity, initial)
        : this.websocketCall(client, lobby, invite, identity, initial);
    this.call = call;

    const recorder = this.extensions.recorder?.(call, title);
    this.callView = new CallView(call, {
      roomTitle: title,
      identity,
      view: prefs.view ?? config.defaultView,
      mirror: () => this.requireLobby().preferences.mirror,
      speakerId: () => this.requireLobby().preferences.speakerId,
      onViewChange: (view) => void this.requireLobby().updatePreferences({ view }),
      onOpenSettings: () => this.settings?.open('video'),
      ...(recorder ? { onToggleRecording: recorder } : {}),
    });
    call.subscribe((snapshot) => {
      this.settings?.refresh();
      if (snapshot.state === 'left') this.finish('Gracias por participar.');
      if (snapshot.state === 'failed') {
        this.finish(snapshot.error?.message ?? 'La llamada terminó por un error.');
      }
    });
    showScreen('call');
    await call.join().catch(() => undefined); // failures arrive through the snapshot
  }

  private webrtcCall(
    client: SignalingClient,
    lobby: LobbyService,
    identity: Identity,
    initial: Handles,
  ): CallController {
    const config = this.requireConfig();
    return new WebRtcCallSession({
      client,
      peers: browserPeerConnectionFactory,
      media: lobby,
      timer: systemTimer,
      time: performanceTimeSource,
      identity,
      initial,
      microphoneEnabled: lobby.preferences.microphoneEnabled,
      defaultProfile: config.defaultProfile,
      resolution: lobby.preferences.resolution,
    });
  }

  private websocketCall(
    client: SignalingClient,
    lobby: LobbyService,
    invite: Invite,
    identity: Identity,
    initial: Handles,
  ): CallController {
    const config = this.requireConfig();
    client.close('websocket-transport'); // media goes over the binary relay instead
    const profile = config.defaultProfile;
    return new WebSocketCallSession({
      link: {
        url: config.relayUrl,
        hello: {
          streamId: `wr-${crypto.randomUUID()}`,
          room: invite.room,
          token: invite.token,
          name: identity.name,
          ...(identity.title ? { title: identity.title } : {}),
          tracks: ['video', 'audio'],
          userAgent: navigator.userAgent,
        },
        transport: new WebSocketTransport(),
        reconnectPolicy: new ReconnectPolicy(),
        timer: systemTimer,
        time: performanceTimeSource,
      },
      media: lobby,
      createPipeline: (sources) =>
        new BrowserMediaPipeline(
          relaySettingsFromProfile(config.relayUrl, profile, {
            camera: true,
            microphone: true,
            screen: true,
            systemAudio: true,
          }),
          sources,
          identity.name,
        ),
      initial,
      microphoneEnabled: lobby.preferences.microphoneEnabled,
      profile,
      timer: systemTimer,
      time: performanceTimeSource,
    });
  }

  private finish(message: string): void {
    this.callView?.dispose();
    this.callView = undefined;
    this.settings?.close();
    this.lobby?.dispose();
    byId('left-message').textContent = message;
    showScreen('left');
  }

  // ----------------------------------------------------------- settings

  private settingsContext(): SettingsContext {
    const { extensions } = this;
    return {
      preferences: () => this.requireLobby().preferences,
      devices: () => this.requireLobby().snapshot.devices,
      profile: () => this.call?.snapshot.profile ?? this.requireConfig().defaultProfile,
      cameraTrack: () =>
        this.call ? this.call.snapshot.local.camera : this.lobby?.snapshot.camera,
      microphoneTrack: () =>
        this.call ? this.call.snapshot.local.microphone : this.lobby?.snapshot.microphone,
      inCall: () => Boolean(this.call),
      apply: (patch) => this.applyPreferences(patch),
      backgrounds: () => extensions.backgrounds?.() ?? [],
      uploadBackground: async (file) => {
        if (!extensions.uploadBackground) return;
        const imageId = await extensions.uploadBackground(file);
        await this.applyPreferences({ effect: { kind: 'image', imageId } });
      },
      effectsStatus: () => extensions.effectsStatus?.() ?? '',
    };
  }

  /** In the lobby the preview reopens itself; in a call the new tracks are swapped in. */
  private async applyPreferences(patch: Partial<UserPreferences>): Promise<void> {
    const lobby = this.requireLobby();
    await lobby.updatePreferences(patch);
    const call = this.call;
    if (!call) return;
    const keys = Object.keys(patch) as (keyof UserPreferences)[];
    try {
      if (keys.some((k) => CAMERA_KEYS.includes(k)) && !call.snapshot.self.cameraOff) {
        await call.replaceCamera(await lobby.openCamera());
      }
      if (keys.some((k) => MICROPHONE_KEYS.includes(k)) && call.snapshot.local.microphone) {
        await call.replaceMicrophone(await lobby.openMicrophone());
      }
    } catch (error) {
      toast((error as Error).message);
    }
    if ('speakerId' in patch) this.callView?.setSpeaker(patch.speakerId);
    this.callView?.refresh();
  }

  // ---------------------------------------------------------- shortcuts

  private onKey(event: KeyboardEvent): void {
    if (this.settings?.isOpen && event.key !== ',') return;
    const action = resolveShortcut({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      editableTarget: isEditable(event.target),
    });
    if (!action || !this.lobby) return;
    event.preventDefault();
    this.runShortcut(action);
  }

  private runShortcut(action: ShortcutAction): void {
    if (action === 'open-settings') {
      if (this.settings?.isOpen) this.settings.close();
      else this.settings?.open('video');
      return;
    }
    if (this.callView) {
      if (action === 'toggle-microphone') void this.callView.toggleMicrophone();
      if (action === 'toggle-camera') void this.callView.toggleCamera();
      if (action === 'toggle-screen') void this.callView.toggleScreen();
      if (action === 'cycle-view') this.callView.cycleView();
    } else if (this.lobbyView) {
      if (action === 'toggle-microphone') void this.lobbyView.toggleMicrophone();
      if (action === 'toggle-camera') void this.lobbyView.toggleCamera();
    }
  }

  // --------------------------------------------------------------- misc

  private invalid(message: string): void {
    byId('invalid-message').textContent = message;
    showScreen('invalid');
  }

  private requireConfig(): AppConfig {
    if (!this.config) throw new Error('config not loaded');
    return this.config;
  }

  private requireLobby(): LobbyService {
    if (!this.lobby) throw new Error('lobby not started');
    return this.lobby;
  }
}

async function loadConfig(): Promise<
  { ok: true; config: AppConfig } | { ok: false; message: string }
> {
  let raw: unknown;
  try {
    const response = await fetch('/config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    raw = await response.json();
  } catch (error) {
    return {
      ok: false,
      message: `No se pudo cargar la configuración del sitio (config.json): ${(error as Error).message}`,
    };
  }
  const result = parseAppConfig(raw);
  return result.ok
    ? result
    : { ok: false, message: `config.json no es válido: ${result.issues.join('; ')}` };
}
