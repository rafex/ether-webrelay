import type { LobbyService, LobbySnapshot } from '../application/lobby-service';
import { initials, validateIdentity } from '../domain/preferences';
import { AudioLevelMeter } from '../infrastructure/audio/audio-level-meter';
import type { DeviceKind, MediaTrackLike } from '../ports/media';
import { attachTrack, byId, setPressed } from './dom';
import { openMenu } from './menu';

export interface LobbyActions {
  openSettings(section?: string): void;
  join(identity: { name: string; title?: string }): void;
}

const CHANNEL_ICONS = new Set(['youtube', 'facebook', 'twitch']);

const STATUS: Record<LobbySnapshot['signaling'], string> = {
  idle: 'Conectando…',
  connecting: 'Conectando con la sala…',
  open: '',
  reconnecting: 'Se perdió la conexión con la sala. Reintentando…',
  closed: '',
  failed: '',
};

/** Binds the "¿Listo para entrar?" screen to the LobbyService. */
export class LobbyView {
  private meter: AudioLevelMeter | undefined;
  private meterTrack: MediaTrackLike | undefined;
  private frame = 0;
  private joining = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly lobby: LobbyService,
    private readonly actions: LobbyActions,
  ) {
    const prefs = lobby.preferences;
    byId<HTMLInputElement>('join-name').value = prefs.name;
    byId<HTMLInputElement>('join-title').value = prefs.title;

    byId('lobby-mic').addEventListener('click', () => void this.toggleMicrophone());
    byId('lobby-cam').addEventListener('click', () => void this.toggleCamera());
    byId('lobby-settings').addEventListener('click', () => actions.openSettings('video'));
    byId('lobby-effects').addEventListener('click', () => actions.openSettings('background'));
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-device-menu]')) {
      button.addEventListener('click', () =>
        this.openDeviceMenu(button, button.dataset.deviceMenu as DeviceKind),
      );
    }
    byId('join-name').addEventListener('input', () => this.render(this.lobby.snapshot));
    byId<HTMLFormElement>('join-form').addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit();
    });
    this.unsubscribe = lobby.subscribe((snapshot) => this.render(snapshot));
    this.render(lobby.snapshot);
    this.loop();
  }

  toggleMicrophone(): Promise<void> {
    return this.lobby.setMicrophoneEnabled(!this.lobby.preferences.microphoneEnabled);
  }

  toggleCamera(): Promise<void> {
    return this.lobby.setCameraEnabled(!this.lobby.preferences.cameraEnabled);
  }

  dispose(): void {
    this.unsubscribe();
    cancelAnimationFrame(this.frame);
    void this.meter?.close();
    this.meter = undefined;
    attachTrack(byId<HTMLVideoElement>('lobby-preview'), undefined);
  }

  private render(snapshot: LobbySnapshot): void {
    const { room, preferences } = snapshot;

    // Room info (left column)
    byId('room-title').textContent =
      room?.title ?? (snapshot.phase === 'connecting' ? 'Conectando con la sala…' : 'Sala');
    byId('host-name').textContent = room?.host.name ?? '';
    byId('host-name').parentElement?.toggleAttribute('hidden', !room);
    const avatar = byId('host-avatar');
    avatar.hidden = !room;
    if (room?.host.avatar) {
      avatar.style.backgroundImage = `url("${encodeURI(room.host.avatar)}")`;
      avatar.textContent = '';
    } else {
      avatar.style.backgroundImage = '';
      avatar.textContent = room ? initials(room.host.name) : '';
    }
    this.renderChannels(room?.channels ?? []);

    // Preview
    const preview = byId<HTMLVideoElement>('lobby-preview');
    attachTrack(preview, snapshot.camera);
    preview.classList.toggle('mirror', preferences.mirror);
    byId('lobby-preview-off').hidden = Boolean(snapshot.camera);
    byId('lobby-initials').textContent = initials(
      byId<HTMLInputElement>('join-name').value || preferences.name,
    );
    setPressed(byId('lobby-mic'), preferences.microphoneEnabled);
    setPressed(byId('lobby-cam'), preferences.cameraEnabled);
    this.syncMeter(snapshot.microphone);

    const mediaError = byId('lobby-media-error');
    mediaError.hidden = !snapshot.mediaError;
    mediaError.textContent = snapshot.mediaError ?? '';

    // Join
    const nameOk = validateIdentity(byId<HTMLInputElement>('join-name').value, '').ok;
    const ready = snapshot.phase === 'ready' && snapshot.signaling === 'open';
    byId<HTMLButtonElement>('join-button').disabled = !ready || !nameOk || this.joining;
    const status =
      snapshot.phase === 'rejected' || snapshot.phase === 'unreachable'
        ? (snapshot.error ?? '')
        : STATUS[snapshot.signaling];
    const statusLine = byId('lobby-status');
    statusLine.textContent = this.joining ? 'Entrando…' : status;
    statusLine.classList.toggle(
      'error',
      snapshot.phase === 'rejected' || snapshot.phase === 'unreachable',
    );
  }

  private renderChannels(channels: readonly string[]): void {
    const wrapper = byId('channels');
    const list = byId('channel-list');
    wrapper.hidden = channels.length === 0;
    list.replaceChildren(
      ...channels.map((channel) => {
        const li = document.createElement('li');
        const id = channel.toLowerCase();
        li.title = channel;
        li.setAttribute('aria-label', channel);
        if (CHANNEL_ICONS.has(id)) {
          li.className = `channel-${id}`;
          li.innerHTML = CHANNEL_SVG[id] ?? '';
        } else {
          li.className = 'channel-other';
          li.textContent = channel.slice(0, 2);
        }
        return li;
      }),
    );
  }

  private openDeviceMenu(anchor: HTMLElement, kind: DeviceKind): void {
    const { devices, preferences } = this.lobby.snapshot;
    const current = kind === 'videoinput' ? preferences.cameraId : preferences.microphoneId;
    const options = devices.filter((d) => d.kind === kind);
    openMenu(
      anchor,
      options.map((d, index) => ({
        value: d.id,
        label: d.label,
        checked: current ? d.id === current : index === 0,
      })),
      (id) =>
        void this.lobby.updatePreferences(
          kind === 'videoinput' ? { cameraId: id } : { microphoneId: id },
        ),
      kind === 'videoinput' ? 'Cámara' : 'Micrófono',
    );
  }

  private submit(): void {
    const identity = validateIdentity(
      byId<HTMLInputElement>('join-name').value,
      byId<HTMLInputElement>('join-title').value,
    );
    const error = byId('join-error');
    if (!identity.ok) {
      error.hidden = false;
      error.textContent = identity.message;
      byId('join-name').focus();
      return;
    }
    error.hidden = true;
    this.joining = true;
    this.render(this.lobby.snapshot);
    this.actions.join({
      name: identity.name,
      ...(identity.title ? { title: identity.title } : {}),
    });
  }

  private syncMeter(track: MediaTrackLike | undefined): void {
    if (track === this.meterTrack) return;
    void this.meter?.close();
    this.meter = undefined;
    this.meterTrack = track;
    if (track) {
      try {
        this.meter = new AudioLevelMeter(track);
      } catch {
        this.meter = undefined;
      }
    }
  }

  private loop(): void {
    const bar = byId('lobby-level');
    const tick = () => {
      const level = this.meter && this.lobby.preferences.microphoneEnabled ? this.meter.level() : 0;
      bar.style.transform = `scaleX(${level.toFixed(3)})`;
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
}

/** Brand glyphs for the channel chips (same drawings as the Pug icon mixin). */
const CHANNEL_SVG: Record<string, string> = {
  youtube:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor"/><path d="m10 9 5 3-5 3z" fill="#fff"/></svg>',
  facebook:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M13 21v-7h2.5l.5-3h-3V9.2c0-.9.3-1.5 1.6-1.5H16V5.1a20 20 0 0 0-2.3-.1C11.4 5 10 6.3 10 8.8V11H7.5v3H10v7" fill="#fff"/></svg>',
  twitch:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h17v11l-5 5h-4l-3 3H7v-3H4z" fill="currentColor"/><path d="M11 8v4M16 8v4" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
};
