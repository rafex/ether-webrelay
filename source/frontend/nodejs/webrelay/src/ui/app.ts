import { RelaySession, type RelayStats, type SessionState } from '../application/relay-session';
import { RelayError } from '../domain/errors';
import { ReconnectPolicy } from '../domain/reconnect-policy';
import { hasAudio, validateSettings } from '../domain/relay-settings';
import { BrowserMediaPipeline } from '../infrastructure/browser-media-pipeline';
import { FfmpegWasmTranscoder } from '../infrastructure/recording/ffmpeg-wasm-transcoder';
import { LocalRecorder } from '../infrastructure/recording/local-recorder';
import { performanceTimeSource } from '../infrastructure/time/performance-time-source';
import { WebSocketTransport } from '../infrastructure/transport/websocket-transport';
import { systemTimer } from '../ports/time';
import {
  type FormValues,
  formatBitrate,
  formatBytes,
  newStreamId,
  settingsFromForm,
} from './settings-form';

const STATE_LABELS: Record<SessionState, string> = {
  idle: 'inactivo',
  starting: 'conectando',
  live: 'en vivo',
  reconnecting: 'reconectando',
  stopping: 'deteniendo',
  stopped: 'detenido',
  failed: 'error',
};

/** Driving adapter: binds the Pug-rendered page to the RelaySession. */
export class RelayApp {
  private session: RelaySession | undefined;
  private pipeline: BrowserMediaPipeline | undefined;
  private statsTimer: number | undefined;
  private lastBytes = 0;
  private lastSample = 0;
  private recording: Blob | undefined;
  private readonly recorder = new LocalRecorder();
  private readonly transcoder = new FfmpegWasmTranscoder();

  constructor(private readonly root: Document) {}

  mount(): void {
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.start();
    });
    this.button('stop').addEventListener('click', () => void this.stop());
    this.button('record').addEventListener('click', () => void this.toggleRecording());
    this.button('export-ogv').addEventListener('click', () => void this.exportOgv());
    window.addEventListener('beforeunload', () => void this.session?.stop());
    if (!window.isSecureContext) {
      this.showMessage(
        'Esta página debe servirse por HTTPS (o localhost) para capturar medios.',
        true,
      );
    }
  }

  private async start(): Promise<void> {
    const settings = settingsFromForm(this.readForm());
    const result = validateSettings(settings);
    this.showErrors(result.ok ? [] : result.issues.map((issue) => issue.message));
    if (!result.ok) return;

    this.pipeline = new BrowserMediaPipeline(settings);
    this.session = new RelaySession(
      {
        pipeline: this.pipeline,
        link: {
          url: settings.bridgeUrl,
          hello: {
            streamId: newStreamId(),
            tracks: hasAudio(settings.sources) ? ['video', 'audio'] : ['video'],
            userAgent: navigator.userAgent,
            ...(settings.token ? { token: settings.token } : {}),
            ...(settings.destination ? { destination: settings.destination } : {}),
          },
          transport: new WebSocketTransport(),
          reconnectPolicy: new ReconnectPolicy(),
          timer: systemTimer,
          time: performanceTimeSource,
        },
      },
      {
        onStateChange: (state) => this.renderState(state),
        onError: (error) => this.showMessage(error.message, true),
      },
    );

    this.setRunning(true);
    try {
      await this.session.start();
      const preview = this.pipeline.previewStream;
      if (preview) this.previewVideo.srcObject = preview;
      this.button('record').disabled = false;
      this.statsTimer = window.setInterval(() => this.renderStats(), 1_000);
      this.showMessage('');
    } catch (error) {
      this.showMessage(error instanceof RelayError ? error.message : String(error), true);
      this.setRunning(false);
    }
  }

  private async stop(): Promise<void> {
    if (this.recorder.recording) await this.toggleRecording();
    await this.session?.stop();
    window.clearInterval(this.statsTimer);
    this.previewVideo.srcObject = null;
    this.setRunning(false);
    this.button('record').disabled = true;
  }

  private async toggleRecording(): Promise<void> {
    const button = this.button('record');
    if (this.recorder.recording) {
      this.recording = await this.recorder.stop();
      button.textContent = 'Grabar local';
      this.button('export-ogv').disabled = false;
      return;
    }
    const stream = this.pipeline?.previewStream;
    if (!stream) return;
    this.recorder.start(stream);
    button.textContent = 'Detener grabación';
  }

  private async exportOgv(): Promise<void> {
    if (!this.recording) return;
    const button = this.button('export-ogv');
    const progress = this.root.querySelector<HTMLProgressElement>('#export-progress');
    button.disabled = true;
    if (progress) progress.hidden = false;
    this.showMessage('Cargando ffmpeg.wasm y convirtiendo a OGV…');
    try {
      const ogv = await this.transcoder.transcode(this.recording, 'ogv', (ratio) => {
        if (progress) progress.value = ratio;
      });
      const link = this.root.createElement('a');
      link.href = URL.createObjectURL(ogv);
      link.download = `ether-webrelay-${new Date().toISOString().replace(/[:.]/g, '-')}.ogv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      this.showMessage('OGV exportado.');
    } catch (error) {
      this.showMessage(`Fallo al exportar OGV: ${(error as Error).message}`, true);
    } finally {
      button.disabled = false;
      if (progress) progress.hidden = true;
    }
  }

  private renderState(state: SessionState): void {
    const badge = this.root.querySelector<HTMLElement>('#state-badge');
    if (badge) {
      badge.dataset.state = state;
      badge.textContent = STATE_LABELS[state];
    }
    if (state === 'failed' || state === 'stopped') {
      window.clearInterval(this.statsTimer);
      this.setRunning(false);
    }
  }

  private renderStats(): void {
    if (!this.session) return;
    const stats = this.session.stats;
    const now = performance.now();
    const bitrate = this.lastSample
      ? ((stats.bytesSent - this.lastBytes) * 8_000) / (now - this.lastSample)
      : 0;
    this.lastBytes = stats.bytesSent;
    this.lastSample = now;
    const values: Record<keyof RelayStats | 'bitrate', string> = {
      bitrate: formatBitrate(bitrate),
      videoFramesSent: String(stats.videoFramesSent),
      audioFramesSent: String(stats.audioFramesSent),
      videoFramesDropped: String(stats.videoFramesDropped),
      audioFramesDropped: String(stats.audioFramesDropped),
      keyframesSent: String(stats.keyframesSent),
      bytesSent: formatBytes(stats.bytesSent),
      reconnects: String(stats.reconnects),
      rttMs: stats.rttMs === undefined ? '–' : `${stats.rttMs.toFixed(0)} ms`,
      bufferedBytes: formatBytes(stats.bufferedBytes),
    };
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-stat]')) {
      const key = element.dataset.stat as keyof typeof values;
      element.textContent = values[key] ?? '–';
    }
  }

  private readForm(): FormValues {
    const values: Record<string, string | boolean> = {};
    for (const element of Array.from(this.form.elements)) {
      if (element instanceof HTMLInputElement) {
        values[element.name] = element.type === 'checkbox' ? element.checked : element.value;
      } else if (element instanceof HTMLSelectElement) {
        values[element.name] = element.value;
      }
    }
    return values;
  }

  private setRunning(running: boolean): void {
    this.button('start').disabled = running;
    this.button('stop').disabled = !running;
    for (const fieldset of Array.from(this.form.querySelectorAll('fieldset')))
      fieldset.disabled = running;
  }

  private showErrors(messages: string[]): void {
    const list = this.root.querySelector<HTMLUListElement>('#form-errors');
    if (!list) return;
    list.replaceChildren(
      ...messages.map((message) =>
        Object.assign(this.root.createElement('li'), { textContent: message }),
      ),
    );
    list.hidden = messages.length === 0;
  }

  private showMessage(text: string, isError = false): void {
    const message = this.root.querySelector<HTMLElement>('#message');
    if (!message) return;
    message.textContent = text;
    message.classList.toggle('error', isError);
  }

  private get form(): HTMLFormElement {
    return this.element<HTMLFormElement>('#relay-form');
  }

  private get previewVideo(): HTMLVideoElement {
    return this.element<HTMLVideoElement>('#preview');
  }

  private button(id: string): HTMLButtonElement {
    return this.element<HTMLButtonElement>(`#${id}`);
  }

  private element<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`missing element ${selector}`);
    return element;
  }
}
