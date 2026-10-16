import type { CallController, CallSnapshot, CallState } from '../application/call-controller';
import type { CallStats } from '../domain/call-stats';
import { initials } from '../domain/preferences';
import { spotlightParticipant } from '../domain/room';
import { nextViewMode, type ViewMode } from '../domain/view-mode';
import type { MediaTrackLike } from '../ports/media';
import { attachTrack, byId, cloneTemplate, setPressed, toast } from './dom';
import { RemoteAudio } from './remote-audio';

export interface CallViewOptions {
  readonly roomTitle: string;
  readonly identity: { readonly name: string; readonly title?: string };
  readonly view: ViewMode;
  readonly mirror: () => boolean;
  readonly speakerId: () => string | undefined;
  readonly onViewChange: (view: ViewMode) => void;
  readonly onOpenSettings: () => void;
  readonly onToggleRecording?: () => Promise<boolean>;
}

interface TileModel {
  readonly key: string;
  readonly name: string;
  /** Person the tile belongs to (avatar initials), without suffixes like "(tú)". */
  readonly person: string;
  readonly title?: string;
  readonly video: MediaTrackLike | undefined;
  readonly muted: boolean;
  readonly sharing: boolean;
  readonly mirror: boolean;
  readonly spotlight: boolean;
}

const STATE_LABELS: Record<CallState, string> = {
  joining: 'Entrando',
  waiting: 'Esperando admisión',
  connected: 'En la sala',
  reconnecting: 'Reconectando',
  left: 'Fuera',
  failed: 'Error',
};

/** Renders the in-call screen from CallController snapshots. */
export class CallView {
  private view: ViewMode;
  private readonly tiles = new Map<string, HTMLElement>();
  private readonly audio: RemoteAudio;
  private readonly unsubscribe: () => void;
  private lastState: CallState | undefined;
  private recording = false;

  constructor(
    private readonly call: CallController,
    private readonly options: CallViewOptions,
  ) {
    this.view = options.view;
    this.audio = new RemoteAudio(byId('call'));
    byId('call-title').textContent = options.roomTitle;

    byId('call-mic').addEventListener('click', () => void this.toggleMicrophone());
    byId('call-cam').addEventListener('click', () => void this.toggleCamera());
    byId('call-screen').addEventListener('click', () => void this.toggleScreen());
    byId('call-settings').addEventListener('click', () => options.onOpenSettings());
    byId('call-leave').addEventListener('click', () => void call.leave());
    byId('call-view').addEventListener('click', () => this.toggleViewMenu());
    for (const option of document.querySelectorAll<HTMLButtonElement>('[data-view-option]')) {
      option.addEventListener('click', () => {
        this.setView(option.dataset.viewOption as ViewMode);
        this.toggleViewMenu(false);
      });
    }
    const record = byId('call-record');
    record.hidden = !options.onToggleRecording;
    record.addEventListener('click', () => void this.toggleRecording());

    this.unsubscribe = call.subscribe((snapshot) => this.render(snapshot));
    this.applyView();
    this.render(call.snapshot);
  }

  toggleMicrophone(): Promise<void> {
    return this.guard(this.call.setMicrophoneEnabled(this.call.snapshot.self.muted));
  }

  toggleCamera(): Promise<void> {
    return this.guard(this.call.setCameraEnabled(this.call.snapshot.self.cameraOff));
  }

  toggleScreen(): Promise<void> {
    return this.guard(
      this.call.snapshot.self.screenSharing
        ? this.call.stopScreenShare()
        : this.call.startScreenShare(),
    );
  }

  cycleView(): void {
    this.setView(nextViewMode(this.view));
  }

  setView(view: ViewMode): void {
    this.view = view;
    this.applyView();
    this.options.onViewChange(view);
  }

  setSpeaker(sinkId: string | undefined): void {
    this.audio.setSink(sinkId);
  }

  refresh(): void {
    this.render(this.call.snapshot);
  }

  dispose(): void {
    this.unsubscribe();
    this.audio.clear();
    for (const tile of this.tiles.values()) tile.remove();
    this.tiles.clear();
  }

  // -------------------------------------------------------------- render

  private render(snapshot: CallSnapshot): void {
    const { state, self } = snapshot;
    for (const badgeId of ['call-badge', 'minimal-state']) {
      const badge = byId(badgeId);
      badge.dataset.state = state;
      badge.textContent = STATE_LABELS[state];
    }
    byId('call-mode-note').hidden = snapshot.mode !== 'websocket';
    if (state !== this.lastState) {
      if (state === 'waiting') toast('El anfitrión tiene que admitirte. Espera un momento…');
      if (state === 'reconnecting') toast('Se perdió la conexión. Reconectando…');
      if (state === 'connected' && this.lastState === 'reconnecting') toast('Conexión recuperada.');
      this.lastState = state;
    }

    setPressed(byId('call-mic'), !self.muted);
    setPressed(byId('call-cam'), !self.cameraOff);
    setPressed(byId('call-screen'), self.screenSharing);
    setControlLabel('call-screen', self.screenSharing ? 'Dejar de compartir' : 'Compartir');

    this.renderTiles(snapshot);
    this.renderAudio(snapshot);
    this.renderStats(snapshot.stats, snapshot);

    const minimal = byId<HTMLVideoElement>('minimal-self');
    attachTrack(minimal, snapshot.local.camera);
    minimal.classList.toggle('mirror', this.options.mirror());
    byId('minimal-off').hidden = Boolean(snapshot.local.camera);
    byId('minimal-initials').textContent = initials(this.options.identity.name);
    const count = snapshot.room.participants.length + 1;
    byId('minimal-count').textContent =
      `${count} ${count === 1 ? 'participante' : 'participantes'}`;
  }

  private renderTiles(snapshot: CallSnapshot): void {
    const models = this.models(snapshot);
    const stage = byId('stage');
    const spotlight = models.some((m) => m.spotlight);
    stage.classList.toggle('has-spotlight', spotlight);
    // Same rule as domain/layout gridLayout: columns = ceil(sqrt(n)).
    const grid = spotlight ? models.length - 1 : models.length;
    const columns = spotlight ? 1 : Math.max(1, Math.ceil(Math.sqrt(grid)));
    stage.style.setProperty('--cols', String(columns));
    stage.style.setProperty('--rows', String(Math.max(1, Math.ceil(grid / columns))));
    const seen = new Set<string>();
    for (const model of models) {
      seen.add(model.key);
      let tile = this.tiles.get(model.key);
      if (!tile) {
        tile = cloneTemplate<HTMLElement>('tpl-tile');
        this.tiles.set(model.key, tile);
      }
      this.updateTile(tile, model);
      stage.append(tile); // keeps DOM order equal to model order
    }
    for (const [key, tile] of this.tiles) {
      if (seen.has(key)) continue;
      attachTrack(tile.querySelector('video') as HTMLVideoElement, undefined);
      tile.remove();
      this.tiles.delete(key);
    }
  }

  private models(snapshot: CallSnapshot): TileModel[] {
    const { self, local, room, remote } = snapshot;
    const tiles: TileModel[] = [];
    const sharer = spotlightParticipant(room);
    if (self.screenSharing && local.screen) {
      tiles.push(this.screenTile('self:screen', `Tu pantalla`, local.screen));
    } else if (sharer) {
      const screen = remote.get(sharer.id)?.screen;
      if (screen)
        tiles.push(this.screenTile(`${sharer.id}:screen`, `Pantalla de ${sharer.name}`, screen));
    }
    tiles.push({
      key: 'self',
      name: `${this.options.identity.name} (tú)`,
      person: this.options.identity.name,
      ...(this.options.identity.title ? { title: this.options.identity.title } : {}),
      video: local.camera,
      muted: self.muted,
      sharing: self.screenSharing,
      mirror: this.options.mirror(),
      spotlight: false,
    });
    for (const participant of room.participants) {
      const media = remote.get(participant.id);
      tiles.push({
        key: participant.id,
        name: participant.name,
        person: participant.name,
        ...(participant.title ? { title: participant.title } : {}),
        video: participant.cameraOff ? undefined : media?.camera,
        muted: participant.muted,
        sharing: participant.screenSharing,
        mirror: false,
        spotlight: false,
      });
    }
    return tiles;
  }

  private screenTile(key: string, name: string, video: MediaTrackLike): TileModel {
    return {
      key,
      name,
      person: name,
      video,
      muted: false,
      sharing: true,
      mirror: false,
      spotlight: true,
    };
  }

  private updateTile(tile: HTMLElement, model: TileModel): void {
    const video = tile.querySelector('video') as HTMLVideoElement;
    attachTrack(video, model.video);
    video.classList.toggle('mirror', model.mirror);
    tile.classList.toggle('video-off', !model.video);
    tile.classList.toggle('muted', model.muted);
    tile.classList.toggle('sharing', model.sharing && !model.spotlight);
    tile.classList.toggle('spotlight', model.spotlight);
    tile.setAttribute('aria-label', model.name);
    (tile.querySelector('.tile-name') as HTMLElement).textContent = model.name;
    (tile.querySelector('.tile-title') as HTMLElement).textContent = model.title ?? '';
    (tile.querySelector('.avatar') as HTMLElement).textContent = initials(model.person);
  }

  private renderAudio(snapshot: CallSnapshot): void {
    const tracks = new Map<string, MediaTrackLike>();
    for (const [id, media] of snapshot.remote) {
      if (media.microphone) tracks.set(`${id}:mic`, media.microphone);
      if (media.screenAudio) tracks.set(`${id}:screen`, media.screenAudio);
    }
    this.audio.sync(tracks);
    this.audio.setSink(this.options.speakerId());
  }

  private renderStats(stats: CallStats | undefined, snapshot: CallSnapshot): void {
    const kbps = (bps: number | undefined) =>
      bps === undefined
        ? '–'
        : bps >= 1_000_000
          ? `${(bps / 1e6).toFixed(2)} Mbps`
          : `${Math.round(bps / 1000)} kbps`;
    const values: Record<string, string> = {
      uploadBps: kbps(stats?.uploadBps),
      downloadBps: snapshot.mode === 'websocket' ? 'n/d' : kbps(stats?.downloadBps),
      rttMs: stats?.rttMs === undefined ? '–' : `${stats.rttMs} ms`,
      packetLossPercent: stats ? `${stats.packetLossPercent} %` : '–',
      sendResolution: stats?.sendResolution ?? '–',
      sendFps: stats?.sendFps === undefined ? '–' : String(Math.round(stats.sendFps)),
      videoCodec: stats?.videoCodec ?? '–',
      candidateType: CANDIDATE_LABELS[stats?.candidateType ?? ''] ?? '–',
      participants: String(snapshot.room.participants.length + 1),
      profile: `${snapshot.profile.height}p${snapshot.profile.framerate} · ${kbps(snapshot.profile.videoBitrate)}`,
    };
    for (const element of document.querySelectorAll<HTMLElement>('[data-stat]')) {
      element.textContent = values[element.dataset.stat ?? ''] ?? '–';
    }
  }

  // ------------------------------------------------------------- helpers

  private applyView(): void {
    byId('call').dataset.view = this.view;
    for (const option of document.querySelectorAll<HTMLElement>('[data-view-option]')) {
      option.setAttribute('aria-checked', String(option.dataset.viewOption === this.view));
    }
  }

  private toggleViewMenu(force?: boolean): void {
    const menu = byId('view-menu');
    const open = force ?? menu.hidden;
    menu.hidden = !open;
    byId('call-view').setAttribute('aria-expanded', String(open));
    if (open) {
      const close = (event: MouseEvent) => {
        if (!menu.contains(event.target as Node) && event.target !== byId('call-view')) {
          this.toggleViewMenu(false);
          document.removeEventListener('click', close, true);
        }
      };
      setTimeout(() => document.addEventListener('click', close, true));
    }
  }

  private async toggleRecording(): Promise<void> {
    if (!this.options.onToggleRecording) return;
    try {
      this.recording = await this.options.onToggleRecording();
      setPressed(byId('call-record'), this.recording);
      setControlLabel('call-record', this.recording ? 'Detener' : 'Grabar');
    } catch (error) {
      toast((error as Error).message);
    }
  }

  private async guard(action: Promise<void>): Promise<void> {
    try {
      await action;
    } catch (error) {
      toast((error as Error).message);
    }
  }
}

function setControlLabel(buttonId: string, text: string): void {
  const label = byId(buttonId).querySelector('.control-label');
  if (label) label.textContent = text;
}

const CANDIDATE_LABELS: Record<string, string> = {
  host: 'Directa (LAN)',
  srflx: 'Directa (NAT)',
  prflx: 'Directa (NAT)',
  relay: 'Retransmitida (TURN)',
};
