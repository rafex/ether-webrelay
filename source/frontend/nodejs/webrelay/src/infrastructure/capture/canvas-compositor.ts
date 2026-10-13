import { fitContain, type OverlayOptions, overlayRect } from '../../domain/layout';
import type { MediaClock } from '../../domain/media-clock';
import { startWorkerTicker, type Ticker } from '../time/worker-ticker';

export interface CompositorOptions {
  readonly screen?: MediaStreamTrack;
  readonly camera?: MediaStreamTrack;
  readonly width: number;
  readonly height: number;
  readonly framerate: number;
  readonly clock: MediaClock;
  readonly overlay?: OverlayOptions;
  /** Drawn when there is no video source (camera off, no share). */
  readonly placeholder?: string;
}

/**
 * Composes screen share + camera (picture-in-picture) onto one canvas and
 * emits a `VideoFrame` per tick, stamped with the shared session clock.
 *
 * Ticks come from a dedicated worker because timers and rAF on the main
 * thread are throttled when the tab is hidden — common while screen sharing.
 */
export class CanvasCompositor {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private screenVideo: HTMLVideoElement | undefined;
  private cameraVideo: HTMLVideoElement | undefined;
  private ticker: Ticker | undefined;

  constructor(
    private readonly options: CompositorOptions,
    private readonly onFrame: (frame: VideoFrame) => void,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = options.width;
    this.canvas.height = options.height;
    const context = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!context) throw new Error('2D canvas context unavailable');
    this.context = context;
    this.screenVideo = options.screen ? videoElementFor(options.screen) : undefined;
    this.cameraVideo = options.camera ? videoElementFor(options.camera) : undefined;
  }

  async start(): Promise<void> {
    await Promise.all([this.screenVideo?.play(), this.cameraVideo?.play()]);
    this.ticker = startWorkerTicker(this.options.framerate, () => this.tick());
  }

  /** Swaps sources while running (camera toggled, screen share started/stopped). */
  async setSources(sources: {
    readonly screen?: MediaStreamTrack;
    readonly camera?: MediaStreamTrack;
  }): Promise<void> {
    this.screenVideo = await swapVideo(this.screenVideo, sources.screen);
    this.cameraVideo = await swapVideo(this.cameraVideo, sources.camera);
  }

  /** Composite output for local preview and recording. */
  captureStream(): MediaStream {
    return this.canvas.captureStream(this.options.framerate);
  }

  stop(): void {
    this.ticker?.stop();
    this.ticker = undefined;
    for (const video of [this.screenVideo, this.cameraVideo]) {
      if (!video) continue;
      video.pause();
      video.srcObject = null;
    }
  }

  private tick(): void {
    this.draw();
    const timestamp = this.options.clock.nowUs();
    this.onFrame(
      new VideoFrame(this.canvas, {
        timestamp,
        duration: Math.round(1_000_000 / this.options.framerate),
      }),
    );
  }

  private draw(): void {
    const { width, height } = this.options;
    const ctx = this.context;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const main = this.screenVideo ?? this.cameraVideo;
    if (!main && this.options.placeholder) {
      ctx.fillStyle = '#1f2430';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#e6e9ef';
      ctx.font = `600 ${Math.round(height / 12)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.options.placeholder, width / 2, height / 2);
    }
    if (main && main.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const rect = fitContain(main.videoWidth, main.videoHeight, width, height);
      ctx.drawImage(main, rect.x, rect.y, rect.width, rect.height);
    }
    const pip = this.screenVideo ? this.cameraVideo : undefined;
    if (pip && pip.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const rect = overlayRect(
        width,
        height,
        pip.videoWidth,
        pip.videoHeight,
        this.options.overlay,
      );
      ctx.drawImage(pip, rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
  }
}

function videoElementFor(track: MediaStreamTrack): HTMLVideoElement {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  return video;
}

async function swapVideo(
  current: HTMLVideoElement | undefined,
  track: MediaStreamTrack | undefined,
): Promise<HTMLVideoElement | undefined> {
  const currentTrack = (current?.srcObject as MediaStream | null)?.getVideoTracks()[0];
  if (currentTrack === track) return current;
  if (current) {
    current.pause();
    current.srcObject = null;
  }
  if (!track) return undefined;
  const video = videoElementFor(track);
  await video.play().catch(() => undefined);
  return video;
}
