import type { CallController, CallSnapshot } from '../application/call-controller';
import { fitContain, gridLayout, type Rect, spotlightLayout } from '../domain/layout';
import { initials } from '../domain/preferences';
import { spotlightParticipant } from '../domain/room';
import { FfmpegWasmTranscoder } from '../infrastructure/recording/ffmpeg-wasm-transcoder';
import { LocalRecorder } from '../infrastructure/recording/local-recorder';
import { startWorkerTicker, type Ticker } from '../infrastructure/time/worker-ticker';
import type { MediaTrackLike } from '../ports/media';
import { byId, toast } from './dom';

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;

interface RecordTile {
  readonly name: string;
  readonly video: MediaTrackLike | undefined;
}

/**
 * Records the call as this participant sees it: everyone in a mosaic (screen
 * share in the spotlight) with all audio mixed, as WebM via MediaRecorder.
 * Nothing leaves the browser; the bridge keeps its own recording.
 */
export class CallRecorder {
  private readonly canvas = document.createElement('canvas');
  private readonly recorder = new LocalRecorder();
  private readonly videos = new Map<MediaTrackLike, HTMLVideoElement>();
  private readonly audioNodes = new Map<MediaTrackLike, MediaStreamAudioSourceNode>();
  private audio: AudioContext | undefined;
  private destination: MediaStreamAudioDestinationNode | undefined;
  private ticker: Ticker | undefined;
  private unsubscribe: (() => void) | undefined;
  private snapshot: CallSnapshot;

  constructor(
    private readonly call: CallController,
    private readonly selfName: string,
  ) {
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.snapshot = call.snapshot;
  }

  get recording(): boolean {
    return this.recorder.recording;
  }

  async start(): Promise<void> {
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('Este navegador no permite grabar (MediaRecorder no disponible).');
    }
    this.audio = new AudioContext();
    this.destination = this.audio.createMediaStreamDestination();
    // With no sources a destination emits no samples at all, which stalls the
    // WebM muxer; a constant zero keeps a continuous (silent) audio track.
    const silence = this.audio.createConstantSource();
    silence.offset.value = 0;
    silence.connect(this.destination);
    silence.start();
    this.unsubscribe = this.call.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.syncAudio();
    });
    this.syncAudio();
    this.ticker = startWorkerTicker(FPS, () => this.draw());
    const stream = this.canvas.captureStream(FPS);
    // A suspended AudioContext yields an audio track with no data, and the WebM
    // muxer then waits forever for it: record video only in that case.
    await this.audio.resume().catch(() => undefined);
    if (this.audio.state === 'running') {
      for (const track of this.destination.stream.getAudioTracks()) stream.addTrack(track);
    } else {
      toast('No se pudo activar el audio: la grabación será solo de video.');
    }
    this.recorder.start(stream);
  }

  async stop(): Promise<Blob> {
    const blob = await this.recorder.stop();
    this.ticker?.stop();
    this.unsubscribe?.();
    for (const node of this.audioNodes.values()) node.disconnect();
    this.audioNodes.clear();
    for (const video of this.videos.values()) video.srcObject = null;
    this.videos.clear();
    await this.audio?.close().catch(() => undefined);
    return blob;
  }

  private tiles(): { spotlight?: RecordTile; tiles: RecordTile[] } {
    const { self, local, room, remote } = this.snapshot;
    const sharer = spotlightParticipant(room);
    const spotlight: RecordTile | undefined =
      self.screenSharing && local.screen
        ? { name: `Pantalla de ${this.selfName}`, video: local.screen }
        : sharer && remote.get(sharer.id)?.screen
          ? { name: `Pantalla de ${sharer.name}`, video: remote.get(sharer.id)?.screen }
          : undefined;
    const tiles: RecordTile[] = [
      { name: this.selfName, video: self.cameraOff ? undefined : local.camera },
      ...room.participants.map((p) => ({
        name: p.name,
        video: p.cameraOff ? undefined : remote.get(p.id)?.camera,
      })),
    ];
    return spotlight ? { spotlight, tiles } : { tiles };
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#17181b';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const { spotlight, tiles } = this.tiles();
    if (spotlight) {
      const layout = spotlightLayout(tiles.length, WIDTH, HEIGHT);
      this.drawTile(ctx, spotlight, layout.main, true);
      tiles.forEach((tile, i) => {
        const rect = layout.thumbnails[i];
        if (rect) this.drawTile(ctx, tile, rect, false);
      });
    } else {
      const rects = gridLayout(tiles.length, WIDTH, HEIGHT);
      tiles.forEach((tile, i) => {
        const rect = rects[i];
        if (rect) this.drawTile(ctx, tile, rect, false);
      });
    }
  }

  private drawTile(
    ctx: CanvasRenderingContext2D,
    tile: RecordTile,
    rect: Rect,
    contain: boolean,
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 10);
    ctx.clip();
    ctx.fillStyle = '#222328';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    const video = tile.video ? this.videoFor(tile.video) : undefined;
    if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const target = contain
        ? fitContain(video.videoWidth, video.videoHeight, rect.width, rect.height)
        : cover(video.videoWidth, video.videoHeight, rect.width, rect.height);
      ctx.drawImage(video, rect.x + target.x, rect.y + target.y, target.width, target.height);
    } else {
      const radius = Math.min(rect.width, rect.height) / 6;
      ctx.fillStyle = '#4b5070';
      ctx.beginPath();
      ctx.arc(rect.x + rect.width / 2, rect.y + rect.height / 2, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.round(radius * 0.8)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initials(tile.name), rect.x + rect.width / 2, rect.y + rect.height / 2);
    }
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const labelWidth = Math.min(ctx.measureText(tile.name).width + 20, rect.width - 16);
    ctx.fillStyle = 'rgba(10, 11, 14, 0.65)';
    ctx.fillRect(rect.x + 8, rect.y + rect.height - 34, labelWidth, 26);
    ctx.fillStyle = '#eceef2';
    ctx.fillText(tile.name, rect.x + 18, rect.y + rect.height - 16, labelWidth - 20);
    ctx.restore();
  }

  private videoFor(track: MediaTrackLike): HTMLVideoElement {
    let video = this.videos.get(track);
    if (!video) {
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = new MediaStream([track as MediaStreamTrack]);
      void video.play().catch(() => undefined);
      this.videos.set(track, video);
    }
    return video;
  }

  private syncAudio(): void {
    const { audio, destination } = this;
    if (!audio || !destination) return;
    const { self, local, remote } = this.snapshot;
    const wanted = new Set<MediaTrackLike>();
    if (local.microphone && !self.muted) wanted.add(local.microphone);
    for (const media of remote.values()) {
      if (media.microphone) wanted.add(media.microphone);
      if (media.screenAudio) wanted.add(media.screenAudio);
    }
    for (const [track, node] of this.audioNodes) {
      if (wanted.has(track)) continue;
      node.disconnect();
      this.audioNodes.delete(track);
    }
    for (const track of wanted) {
      if (this.audioNodes.has(track)) continue;
      const node = audio.createMediaStreamSource(new MediaStream([track as MediaStreamTrack]));
      node.connect(destination);
      this.audioNodes.set(track, node);
    }
  }
}

function cover(sourceWidth: number, sourceHeight: number, width: number, height: number): Rect {
  if (sourceWidth <= 0 || sourceHeight <= 0) return { x: 0, y: 0, width, height };
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const w = sourceWidth * scale;
  const h = sourceHeight * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

/** Recording toggle for CallView: starts, or stops and offers the file. */
export function recordingToggle(
  call: CallController,
  title: string,
  selfName: string,
): () => Promise<boolean> {
  const recorder = new CallRecorder(call, selfName);
  return async () => {
    if (!recorder.recording) {
      await recorder.start();
      toast('Grabando en este navegador. Pulsa de nuevo para terminar.');
      return true;
    }
    presentRecording(await recorder.stop(), title);
    return false;
  };
}

const transcoder = new FfmpegWasmTranscoder();

function presentRecording(blob: Blob, title: string): void {
  const panel = byId('recording-ready');
  const status = byId('recording-status');
  const base = `${title.replace(/[^\w\-áéíóúñ ]+/gi, '').trim() || 'llamada'} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  panel.hidden = false;
  const size =
    blob.size >= 1024 * 1024
      ? `${(blob.size / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(blob.size / 1024))} KB`;
  status.textContent = `Grabación lista (${size}).`;
  byId('recording-webm').onclick = () => download(blob, `${base}.webm`);
  byId('recording-ogv').onclick = async () => {
    const button = byId<HTMLButtonElement>('recording-ogv');
    button.disabled = true;
    status.textContent = 'Convirtiendo a OGV con ffmpeg.wasm…';
    try {
      const ogv = await transcoder.transcode(blob, 'ogv', (ratio) => {
        status.textContent = `Convirtiendo a OGV… ${Math.round(ratio * 100)} %`;
      });
      download(ogv, `${base}.ogv`);
      status.textContent = 'OGV exportado.';
    } catch (error) {
      status.textContent = `No se pudo convertir: ${(error as Error).message}`;
    } finally {
      button.disabled = false;
    }
  };
  byId('recording-close').onclick = () => {
    panel.hidden = true;
  };
}

function download(blob: Blob, filename: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}
