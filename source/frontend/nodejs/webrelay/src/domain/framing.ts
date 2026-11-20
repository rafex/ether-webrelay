/**
 * Automatic framing: keep the face centered and at a steady size by cropping the camera frame.
 * Pure geometry and smoothing, no browser types, so it is tested without a camera.
 *
 * The detector says where the face is a few times per second. The framer turns that into a crop
 * rectangle with the frame's aspect ratio (so the output never stretches), moves toward it
 * smoothly (no jumps) and ignores small movements (no jitter). When the face is lost it holds the
 * framing for a while and then eases back to the full frame.
 */

export interface Size {
  readonly w: number;
  readonly h: number;
}

export interface Rect extends Size {
  readonly x: number;
  readonly y: number;
}

export interface FramingParams {
  /** The face should take this fraction of the crop's height. */
  readonly faceHeightRatio: number;
  /** Never zoom in more than this (cropping a 720p frame beyond ~2x is visibly soft). */
  readonly maxZoom: number;
  /** Face center sits at this fraction of the crop's height from the top (leaves headroom). */
  readonly headroom: number;
  /** A new target closer than this fraction of the frame to the current one is ignored. */
  readonly deadzone: number;
  /** Time constant of the movement toward the target. */
  readonly smoothingMs: number;
  /** Without a face, keep the framing this long before easing back to the full frame. */
  readonly holdMs: number;
}

export const DEFAULT_FRAMING: FramingParams = {
  faceHeightRatio: 0.32,
  maxZoom: 1.8,
  headroom: 0.42,
  deadzone: 0.04,
  smoothingMs: 450,
  holdMs: 2500,
};

const fullFrame = (frame: Size): Rect => ({ x: 0, y: 0, w: frame.w, h: frame.h });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The largest face is the one being framed (the person at the camera). */
export function pickFace(faces: readonly Rect[]): Rect | undefined {
  let best: Rect | undefined;
  for (const face of faces) {
    if (face.w > 0 && face.h > 0 && (!best || face.w * face.h > best.w * best.h)) best = face;
  }
  return best;
}

/** The crop that frames `face` in `frame` (always inside the frame, same aspect ratio). */
export function targetCrop(face: Rect | undefined, frame: Size, params: FramingParams): Rect {
  if (!face) return fullFrame(frame);
  const aspect = frame.w / frame.h;
  const cropH = clamp(face.h / params.faceHeightRatio, frame.h / params.maxZoom, frame.h);
  const cropW = cropH * aspect;
  const centerX = face.x + face.w / 2;
  const centerY = face.y + face.h / 2;
  return {
    x: clamp(centerX - cropW / 2, 0, frame.w - cropW),
    y: clamp(centerY - params.headroom * cropH, 0, frame.h - cropH),
    w: cropW,
    h: cropH,
  };
}

const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export class Framer {
  private target: Rect;
  private current: Rect;
  private lastFaceAt: number | undefined;
  private lastTickAt: number | undefined;

  constructor(
    private readonly frame: Size,
    private readonly params: FramingParams = DEFAULT_FRAMING,
  ) {
    this.target = fullFrame(frame);
    this.current = this.target;
  }

  /** Reports the face found by the latest detection (undefined: none) at time `now` (ms). */
  observe(face: Rect | undefined, now: number): void {
    if (face) {
      const first = this.lastFaceAt === undefined;
      this.lastFaceAt = now;
      const desired = targetCrop(face, this.frame, this.params);
      if (first || this.moved(desired)) this.target = desired;
      return;
    }
    const lost = this.lastFaceAt !== undefined && now - this.lastFaceAt > this.params.holdMs;
    if (lost && this.moved(fullFrame(this.frame))) this.target = fullFrame(this.frame);
  }

  /** The crop to draw at time `now` (ms): the current one moved toward the target. */
  crop(now: number): Rect {
    const dt = this.lastTickAt === undefined ? 0 : Math.max(0, now - this.lastTickAt);
    this.lastTickAt = now;
    const alpha = 1 - Math.exp(-dt / this.params.smoothingMs);
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    this.current = {
      x: lerp(this.current.x, this.target.x),
      y: lerp(this.current.y, this.target.y),
      w: lerp(this.current.w, this.target.w),
      h: lerp(this.current.h, this.target.h),
    };
    return this.current;
  }

  /** Is `desired` far enough from the present target to be worth moving to? */
  private moved(desired: Rect): boolean {
    const a = center(desired);
    const b = center(this.target);
    return (
      Math.abs(a.x - b.x) >= this.params.deadzone * this.frame.w ||
      Math.abs(a.y - b.y) >= this.params.deadzone * this.frame.h ||
      Math.abs(desired.h - this.target.h) >= this.params.deadzone * this.frame.h
    );
  }
}
