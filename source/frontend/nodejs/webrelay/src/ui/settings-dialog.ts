import { type UserPreferences, type VideoEffect, validateIdentity } from '../domain/preferences';
import {
  availableResolutions,
  type QualityProfile,
  type ResolutionChoice,
} from '../domain/quality-profile';
import { SHORTCUTS } from '../domain/shortcuts';
import { AudioLevelMeter } from '../infrastructure/audio/audio-level-meter';
import type { DeviceInfo, DeviceKind, MediaTrackLike } from '../ports/media';
import { applySink, attachTrack, byId, canSelectSpeaker } from './dom';

export interface BackgroundOption {
  readonly id: string;
  readonly label: string;
  readonly thumbnail: string;
}

/** What the dialog reads and changes; the app wires it to the lobby or the call. */
export interface SettingsContext {
  preferences(): UserPreferences;
  devices(): readonly DeviceInfo[];
  profile(): QualityProfile;
  cameraTrack(): MediaTrackLike | undefined;
  microphoneTrack(): MediaTrackLike | undefined;
  inCall(): boolean;
  apply(patch: Partial<UserPreferences>): Promise<void>;
  backgrounds(): readonly BackgroundOption[];
  uploadBackground(file: File): Promise<void>;
  effectsStatus(): string;
}

const RESOLUTION_LABELS: Record<ResolutionChoice, string> = {
  auto: 'Automática',
  '360p': '360p (ahorro de datos)',
  '720p': '720p (HD)',
  '1080p': '1080p (Full HD)',
};

const EFFECT_KEYS: Record<string, VideoEffect> = {
  none: { kind: 'none' },
  'blur-light': { kind: 'blur', strength: 'light' },
  'blur-strong': { kind: 'blur', strength: 'strong' },
};

export type SettingsSection = 'video' | 'audio' | 'background' | 'profile' | 'shortcuts';

/** Modal settings (Video y efectos, Audio, Fondo virtual, Perfil, Atajos). */
export class SettingsDialog {
  private readonly dialog = byId<HTMLDialogElement>('settings');
  private meter: AudioLevelMeter | undefined;
  private meterTrack: MediaTrackLike | undefined;
  private frame = 0;

  constructor(private readonly ctx: SettingsContext) {
    for (const tab of this.dialog.querySelectorAll<HTMLButtonElement>('[data-section]')) {
      tab.addEventListener('click', () => this.showSection(tab.dataset.section as SettingsSection));
    }
    for (const tab of this.dialog.querySelectorAll<HTMLButtonElement>('[data-video-tab]')) {
      tab.addEventListener('click', () => this.showVideoTab(tab.dataset.videoTab ?? 'camera'));
    }
    byId('settings-close').addEventListener('click', () => this.close());
    this.dialog.addEventListener('close', () => this.stopMeter());
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.close(); // click on the backdrop
    });

    this.onChange('set-camera', (v) => ({ cameraId: v }));
    this.onChange('set-microphone', (v) => ({ microphoneId: v }));
    this.onChange('set-speaker', (v) => ({ speakerId: v }));
    this.onChange('set-resolution', (v) => ({ resolution: v as ResolutionChoice }));
    this.onToggle('set-mirror', (checked) => ({ mirror: checked }));
    this.onToggle('set-echo', (checked) => ({
      audio: { ...this.prefs.audio, echoCancellation: checked },
    }));
    this.onToggle('set-noise', (checked) => ({
      audio: { ...this.prefs.audio, noiseSuppression: checked },
    }));
    this.onToggle('set-gain', (checked) => ({
      audio: { ...this.prefs.audio, autoGainControl: checked },
    }));

    this.dialog.addEventListener('click', (event) => {
      const choice = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-effect]');
      if (!choice?.dataset.effect) return;
      const effect = EFFECT_KEYS[choice.dataset.effect] ?? {
        kind: 'image' as const,
        imageId: choice.dataset.effect.replace(/^image:/, ''),
      };
      void this.ctx.apply({ effect }).then(() => this.refresh());
    });
    byId<HTMLInputElement>('background-upload').addEventListener('change', (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (file) void this.ctx.uploadBackground(file).then(() => this.refresh());
    });

    for (const id of ['set-name', 'set-title']) {
      byId<HTMLInputElement>(id).addEventListener('change', () => {
        const name = byId<HTMLInputElement>('set-name').value;
        const title = byId<HTMLInputElement>('set-title').value;
        const identity = validateIdentity(name, title);
        const hint = byId('profile-hint');
        if (!identity.ok) {
          hint.textContent = identity.message;
          return;
        }
        hint.textContent = 'Así te verán los demás participantes y en la emisión.';
        void this.ctx.apply({ name: identity.name, title: identity.title ?? '' });
        const lobbyName = document.getElementById('join-name') as HTMLInputElement | null;
        const lobbyTitle = document.getElementById('join-title') as HTMLInputElement | null;
        if (lobbyName) lobbyName.value = identity.name;
        if (lobbyTitle) lobbyTitle.value = identity.title ?? '';
      });
    }

    byId('test-speaker').addEventListener('click', () => void this.testSpeaker());
    byId('speaker-field').hidden = !canSelectSpeaker();
    byId('shortcut-list').replaceChildren(
      ...SHORTCUTS.map((shortcut) => {
        const row = document.createElement('div');
        const dt = document.createElement('dt');
        const kbd = document.createElement('kbd');
        kbd.textContent = shortcut.key.toUpperCase();
        dt.append(kbd);
        const dd = document.createElement('dd');
        dd.textContent = shortcut.label;
        row.append(dt, dd);
        return row;
      }),
    );
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  open(section: SettingsSection = 'video'): void {
    this.refresh();
    this.showSection(section);
    if (!this.dialog.open) this.dialog.showModal();
    this.startMeter();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  /** Re-reads devices, preferences and tracks (call after any change). */
  refresh(): void {
    const prefs = this.prefs;
    const devices = this.ctx.devices();
    this.fillDevices('set-camera', devices, 'videoinput', prefs.cameraId);
    this.fillDevices('set-microphone', devices, 'audioinput', prefs.microphoneId);
    this.fillDevices('set-speaker', devices, 'audiooutput', prefs.speakerId);
    this.fillOptions(
      'set-resolution',
      availableResolutions(this.ctx.profile()).map((choice) => ({
        value: choice,
        label: RESOLUTION_LABELS[choice],
      })),
      prefs.resolution,
    );
    byId<HTMLInputElement>('set-mirror').checked = prefs.mirror;
    byId<HTMLInputElement>('set-echo').checked = prefs.audio.echoCancellation;
    byId<HTMLInputElement>('set-noise').checked = prefs.audio.noiseSuppression;
    byId<HTMLInputElement>('set-gain').checked = prefs.audio.autoGainControl;

    const preview = byId<HTMLVideoElement>('settings-preview');
    attachTrack(preview, this.dialog.open ? this.ctx.cameraTrack() : undefined);
    preview.classList.toggle('mirror', prefs.mirror);

    this.renderBackgrounds();
    this.markEffect(prefs.effect);
    byId('effects-status').textContent = this.ctx.effectsStatus();

    const name = byId<HTMLInputElement>('set-name');
    const title = byId<HTMLInputElement>('set-title');
    if (document.activeElement !== name) name.value = prefs.name;
    if (document.activeElement !== title) title.value = prefs.title;
    const inCall = this.ctx.inCall();
    name.disabled = inCall;
    title.disabled = inCall;
    if (inCall) byId('profile-hint').textContent = 'El nombre se cambia antes de entrar a la sala.';

    if (this.dialog.open) this.startMeter();
  }

  private get prefs(): UserPreferences {
    return this.ctx.preferences();
  }

  private showSection(section: SettingsSection): void {
    for (const tab of this.dialog.querySelectorAll<HTMLElement>('[data-section]')) {
      tab.setAttribute('aria-current', String(tab.dataset.section === section));
    }
    for (const panel of this.dialog.querySelectorAll<HTMLElement>('[data-section-panel]')) {
      panel.hidden = panel.dataset.sectionPanel !== section;
    }
    if (section === 'video')
      attachTrack(byId('settings-preview') as HTMLVideoElement, this.ctx.cameraTrack());
  }

  private showVideoTab(tab: string): void {
    for (const button of this.dialog.querySelectorAll<HTMLElement>('[data-video-tab]')) {
      button.setAttribute('aria-selected', String(button.dataset.videoTab === tab));
    }
    for (const panel of this.dialog.querySelectorAll<HTMLElement>('[data-video-panel]')) {
      panel.hidden = panel.dataset.videoPanel !== tab;
    }
  }

  private renderBackgrounds(): void {
    const grid = byId('background-choices');
    for (const old of grid.querySelectorAll('[data-effect^="image:"]')) old.remove();
    for (const background of this.ctx.backgrounds()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice with-image';
      button.dataset.effect = `image:${background.id}`;
      button.style.backgroundImage = `url("${background.thumbnail}")`;
      button.textContent = background.label;
      grid.append(button);
    }
  }

  private markEffect(effect: VideoEffect): void {
    const key =
      effect.kind === 'none'
        ? 'none'
        : effect.kind === 'blur'
          ? `blur-${effect.strength}`
          : `image:${effect.imageId}`;
    for (const choice of this.dialog.querySelectorAll<HTMLElement>('[data-effect]')) {
      choice.setAttribute('aria-pressed', String(choice.dataset.effect === key));
    }
  }

  private fillDevices(
    id: string,
    devices: readonly DeviceInfo[],
    kind: DeviceKind,
    selected: string | undefined,
  ): void {
    const options = devices
      .filter((d) => d.kind === kind)
      .map((d) => ({ value: d.id, label: d.label }));
    this.fillOptions(
      id,
      options.length ? options : [{ value: '', label: 'Predeterminado' }],
      selected,
    );
  }

  private fillOptions(
    id: string,
    options: readonly { value: string; label: string }[],
    selected: string | undefined,
  ): void {
    const select = byId<HTMLSelectElement>(id);
    select.replaceChildren(
      ...options.map((option) => {
        const element = document.createElement('option');
        element.value = option.value;
        element.textContent = option.label;
        return element;
      }),
    );
    if (selected !== undefined && options.some((o) => o.value === selected))
      select.value = selected;
  }

  private onChange(id: string, patch: (value: string) => Partial<UserPreferences>): void {
    byId<HTMLSelectElement>(id).addEventListener('change', (event) => {
      void this.ctx
        .apply(patch((event.target as HTMLSelectElement).value))
        .then(() => this.refresh());
    });
  }

  private onToggle(id: string, patch: (checked: boolean) => Partial<UserPreferences>): void {
    byId<HTMLInputElement>(id).addEventListener('change', (event) => {
      void this.ctx
        .apply(patch((event.target as HTMLInputElement).checked))
        .then(() => this.refresh());
    });
  }

  private async testSpeaker(): Promise<void> {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const destination = context.createMediaStreamDestination();
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.2, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.8);
    oscillator.connect(gain).connect(destination);
    const audio = new Audio();
    audio.srcObject = destination.stream;
    await applySink(audio, this.prefs.speakerId);
    oscillator.start();
    await audio.play().catch(() => undefined);
    oscillator.stop(context.currentTime + 0.8);
    setTimeout(() => void context.close(), 1_000);
  }

  private startMeter(): void {
    const track = this.ctx.microphoneTrack();
    if (track !== this.meterTrack) {
      void this.meter?.close();
      this.meterTrack = track;
      this.meter = undefined;
      try {
        if (track) this.meter = new AudioLevelMeter(track);
      } catch {
        this.meter = undefined;
      }
    }
    if (this.frame) return;
    const bar = byId('settings-level');
    const tick = () => {
      bar.style.transform = `scaleX(${(this.meter?.level() ?? 0).toFixed(3)})`;
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stopMeter(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    void this.meter?.close();
    this.meter = undefined;
    this.meterTrack = undefined;
    attachTrack(byId('settings-preview') as HTMLVideoElement, undefined);
  }
}
