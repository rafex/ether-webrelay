import type { FaceDetector, ImageSegmenter } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import { Framer, pickFace, type Rect } from '../../domain/framing';
import { PRESET_BACKGROUNDS, type VideoEffect } from '../../domain/preferences';
import type { MediaTrackLike } from '../../ports/media';
import type { ProcessedTrack, VideoEffectsPort } from '../../ports/video-effects';
import { startWorkerTicker, type Ticker } from '../time/worker-ticker';
import { hasPreset, paintPreset, presetThumbnail } from './backgrounds';

/** Segmentation runs on a small copy of the frame; the mask is scaled up smoothly. */
const MASK_WIDTH = 256;
const BLUR_FACTOR = { light: 10, strong: 24 } as const;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Face detection is a few times per second: faces do not move at frame rate, and it is the costly part. */
const DETECT_EVERY_MS = 120;

/**
 * VideoEffectsPort with MediaPipe: the selfie segmenter for background blur and
 * replacement, and the face detector for automatic framing. The wasm runtime is
 * self-hosted (bundled by Vite) and, like the models, only loaded when first
 * used. Any failure falls back to the untouched camera (or to the effect alone
 * when only the framing failed) so the call never loses video because of an effect.
 */
export class MediaPipeEffects implements VideoEffectsPort {
  private segmenter: Promise<ImageSegmenter> | undefined;
  private detector: Promise<FaceDetector> | undefined;
  private statusText = '';
  private readonly uploads = new Map<string, HTMLImageElement>();
  private uploadCounter = 0;

  constructor(
    private readonly modelUrl: string,
    private readonly faceModelUrl: string,
  ) {}

  get status(): string {
    return this.statusText;
  }

  backgrounds(): { id: string; label: string; thumbnail: string }[] {
    return [
      ...PRESET_BACKGROUNDS.map((bg) => ({ ...bg, thumbnail: presetThumbnail(bg.id) })),
      ...[...this.uploads.entries()].map(([id, image], index) => ({
        id,
        label: `Imagen ${index + 1}`,
        thumbnail: image.src,
      })),
    ];
  }

  /** Registers an uploaded image for this session and returns its effect id. */
  async registerImage(file: File): Promise<string> {
    if (!file.type.startsWith('image/')) throw new Error('El archivo no es una imagen.');
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('La imagen supera los 8 MB.');
    const image = new Image();
    image.src = URL.createObjectURL(file);
    await image.decode();
    const id = `upload-${++this.uploadCounter}`;
    this.uploads.set(id, image);
    return id;
  }

  async apply(
    source: MediaTrackLike,
    effect: VideoEffect,
    framing = false,
  ): Promise<ProcessedTrack> {
    const passthrough = { track: source, stop: () => undefined };
    if (effect.kind === 'none' && !framing) return passthrough;
    try {
      this.statusText = 'Cargando el modelo de efectos…';
      const segmenter = effect.kind === 'none' ? undefined : await this.loadSegmenter();
      let detector: FaceDetector | undefined;
      if (framing) {
        try {
          detector = await this.loadDetector();
        } catch (error) {
          this.detector = undefined; // retry next time
          this.statusText = `El encuadre automático no está disponible: ${(error as Error).message}`;
          if (!segmenter) return passthrough;
        }
      }
      if (detector || !framing) this.statusText = '';
      return new EffectPipeline(source, effect, segmenter, detector, (id) =>
        this.backgroundFor(id),
      ).start();
    } catch (error) {
      this.segmenter = undefined; // retry next time
      this.statusText = `Los efectos no están disponibles: ${(error as Error).message}`;
      return passthrough;
    }
  }

  private backgroundFor(id: string): HTMLImageElement | 'preset' | undefined {
    if (this.uploads.has(id)) return this.uploads.get(id);
    return hasPreset(id) ? 'preset' : undefined;
  }

  private loadDetector(): Promise<FaceDetector> {
    this.detector ??= (async () => {
      const { FaceDetector } = await import('@mediapipe/tasks-vision');
      const fileset = { wasmLoaderPath, wasmBinaryPath };
      const options = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: this.faceModelUrl, delegate },
        runningMode: 'VIDEO' as const,
        minDetectionConfidence: 0.5,
      });
      try {
        return await FaceDetector.createFromOptions(fileset, options('GPU'));
      } catch {
        return FaceDetector.createFromOptions(fileset, options('CPU'));
      }
    })();
    return this.detector;
  }

  private loadSegmenter(): Promise<ImageSegmenter> {
    this.segmenter ??= (async () => {
      const { ImageSegmenter } = await import('@mediapipe/tasks-vision');
      const fileset = { wasmLoaderPath, wasmBinaryPath };
      const options = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: this.modelUrl, delegate },
        runningMode: 'VIDEO' as const,
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
      try {
        return await ImageSegmenter.createFromOptions(fileset, options('GPU'));
      } catch {
        return ImageSegmenter.createFromOptions(fileset, options('CPU'));
      }
    })();
    return this.segmenter;
  }
}

class EffectPipeline {
  private readonly video = document.createElement('video');
  private readonly output = document.createElement('canvas');
  private readonly small = document.createElement('canvas');
  private readonly mask = document.createElement('canvas');
  private readonly person = document.createElement('canvas');
  private readonly blurred = document.createElement('canvas');
  private ticker: Ticker | undefined;
  private lastTimestamp = 0;
  private outputTrack: MediaStreamTrack | undefined;
  /** Automatic framing: where the crop is now (source pixels), updated every frame. */
  private framer: Framer | undefined;
  private crop: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private lastDetectAt = 0;
  private lastDetectTimestamp = 0;

  constructor(
    private readonly source: MediaTrackLike,
    private readonly effect: VideoEffect,
    private readonly segmenter: ImageSegmenter | undefined,
    private readonly detector: FaceDetector | undefined,
    private readonly background: (id: string) => HTMLImageElement | 'preset' | undefined,
  ) {}

  async start(): Promise<ProcessedTrack> {
    const settings = this.source.getSettings();
    const width = settings.width ?? 1280;
    const height = settings.height ?? 720;
    const framerate = 30;
    for (const canvas of [this.output, this.person]) {
      canvas.width = width;
      canvas.height = height;
    }
    this.small.width = MASK_WIDTH;
    this.small.height = Math.max(1, Math.round((MASK_WIDTH * height) / width));
    this.mask.width = this.small.width;
    this.mask.height = this.small.height;

    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = new MediaStream([this.source as MediaStreamTrack]);
    await this.video.play();
    this.crop = {
      x: 0,
      y: 0,
      w: this.video.videoWidth || width,
      h: this.video.videoHeight || height,
    };
    if (this.detector) this.framer = new Framer({ w: this.crop.w, h: this.crop.h });

    this.outputTrack = this.output.captureStream(framerate).getVideoTracks()[0];
    if (!this.outputTrack) throw new Error('captureStream no entregó video');
    if (this.effect.kind === 'blur') {
      const factor = BLUR_FACTOR[this.effect.strength];
      this.blurred.width = Math.max(1, Math.round(width / factor));
      this.blurred.height = Math.max(1, Math.round(height / factor));
    }
    this.ticker = startWorkerTicker(framerate, () => this.render());

    const track = this.outputTrack;
    return { track, stop: () => this.stop() };
  }

  private render(): void {
    if (this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const { width, height } = this.output;
    const out = this.output.getContext('2d');
    this.updateFraming();
    const segmenter = this.segmenter;
    if (!segmenter) {
      // Framing only: the cropped camera is the whole picture.
      if (out) this.drawVideo(out, width, height);
      return;
    }
    const small = this.small.getContext('2d', { willReadFrequently: true });
    const maskCtx = this.mask.getContext('2d');
    const personCtx = this.person.getContext('2d');
    if (!out || !small || !maskCtx || !personCtx) return;

    // 1. Segment a small copy of the frame.
    this.drawVideo(small, this.small.width, this.small.height);
    const timestamp = Math.max(this.lastTimestamp + 1, performance.now());
    this.lastTimestamp = timestamp;
    const result = segmenter.segmentForVideo(this.small, timestamp);
    const confidence = result.confidenceMasks?.[0]?.getAsFloat32Array();
    result.close();
    if (!confidence) return;
    const image = maskCtx.createImageData(this.mask.width, this.mask.height);
    for (let i = 0; i < confidence.length; i++) image.data[i * 4 + 3] = (confidence[i] ?? 0) * 255;
    maskCtx.putImageData(image, 0, 0);

    // 2. Background: blurred frame or replacement image.
    this.paintBackground(out, width, height);

    // 3. Person cut out with the (smoothly upscaled) mask, drawn on top.
    personCtx.globalCompositeOperation = 'source-over';
    personCtx.clearRect(0, 0, width, height);
    this.drawVideo(personCtx, width, height);
    personCtx.globalCompositeOperation = 'destination-in';
    personCtx.imageSmoothingEnabled = true;
    personCtx.drawImage(this.mask, 0, 0, width, height);
    out.drawImage(this.person, 0, 0);
  }

  /** Draws the camera frame, cropped when framing is on, scaled over the whole destination. */
  private drawVideo(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const c = this.crop;
    ctx.drawImage(this.video, c.x, c.y, c.w, c.h, 0, 0, w, h);
  }

  /** Looks for the face a few times a second and moves the crop toward it, smoothly. */
  private updateFraming(): void {
    const framer = this.framer;
    if (!framer || !this.detector) return;
    const now = performance.now();
    if (now - this.lastDetectAt >= DETECT_EVERY_MS) {
      this.lastDetectAt = now;
      try {
        this.lastDetectTimestamp = Math.max(this.lastDetectTimestamp + 1, Math.round(now));
        const result = this.detector.detectForVideo(this.video, this.lastDetectTimestamp);
        const faces = result.detections.flatMap(({ boundingBox: b }) =>
          b ? [{ x: b.originX, y: b.originY, w: b.width, h: b.height }] : [],
        );
        framer.observe(pickFace(faces), now);
      } catch {
        // A failed pass keeps the current framing; the next one tries again.
      }
    }
    this.crop = framer.crop(now);
  }

  private paintBackground(out: CanvasRenderingContext2D, width: number, height: number): void {
    if (this.effect.kind === 'blur') {
      // Downscale-upscale blur: cheap and works where canvas filters do not (Safari).
      const blurCtx = this.blurred.getContext('2d');
      if (blurCtx) this.drawVideo(blurCtx, this.blurred.width, this.blurred.height);
      out.imageSmoothingEnabled = true;
      out.imageSmoothingQuality = 'high';
      out.drawImage(this.blurred, 0, 0, width, height);
      return;
    }
    if (this.effect.kind !== 'image') return;
    const background = this.background(this.effect.imageId);
    if (background === 'preset' || !background) {
      paintPreset(out, this.effect.imageId, width, height);
      return;
    }
    // "Cover" the frame with the uploaded image.
    const scale = Math.max(width / background.naturalWidth, height / background.naturalHeight);
    const w = background.naturalWidth * scale;
    const h = background.naturalHeight * scale;
    out.drawImage(background, (width - w) / 2, (height - h) / 2, w, h);
  }

  private stop(): void {
    this.ticker?.stop();
    this.outputTrack?.stop();
    this.video.pause();
    this.video.srcObject = null;
  }
}
