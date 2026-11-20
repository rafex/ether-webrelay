import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FRAMING,
  Framer,
  pickFace,
  type Rect,
  type Size,
  targetCrop,
} from '../../src/domain/framing';

const FRAME: Size = { w: 1280, h: 720 };
const ASPECT = FRAME.w / FRAME.h;
const P = DEFAULT_FRAMING;

const face = (cx: number, cy: number, h: number): Rect => ({
  x: cx - h / 2,
  y: cy - h / 2,
  w: h,
  h,
});

const inside = (r: Rect) =>
  r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= FRAME.w + 1e-9 && r.y + r.h <= FRAME.h + 1e-9;

describe('targetCrop', () => {
  it('shows the whole frame when there is no face', () => {
    expect(targetCrop(undefined, FRAME, P)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });

  it('zooms in so the face takes the configured share of the height, centered with headroom', () => {
    const f = face(640, 300, 144); // a 144 px face
    const crop = targetCrop(f, FRAME, P);
    expect(crop.h).toBeCloseTo(144 / P.faceHeightRatio, 6); // 450
    expect(crop.w / crop.h).toBeCloseTo(ASPECT, 6); // never stretches
    expect(crop.x + crop.w / 2).toBeCloseTo(640, 6);
    expect(crop.y + P.headroom * crop.h).toBeCloseTo(300, 6);
    expect(inside(crop)).toBe(true);
  });

  it('never zooms in past maxZoom', () => {
    const crop = targetCrop(face(640, 360, 40), FRAME, P); // a far-away face
    expect(crop.h).toBeCloseTo(FRAME.h / P.maxZoom, 6);
  });

  it('never zooms out past the frame (a big face = the whole frame)', () => {
    const crop = targetCrop(face(640, 360, 600), FRAME, P);
    expect(crop).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });

  it('stays inside the frame when the face is at an edge', () => {
    for (const [cx, cy] of [
      [30, 30],
      [1250, 30],
      [30, 700],
      [1250, 700],
    ] as const) {
      expect(inside(targetCrop(face(cx, cy, 140), FRAME, P))).toBe(true);
    }
  });
});

describe('pickFace', () => {
  it('picks the largest face and ignores empty ones', () => {
    const small = face(100, 100, 50);
    const big = face(900, 400, 200);
    expect(pickFace([small, big])).toBe(big);
    expect(pickFace([{ x: 0, y: 0, w: 0, h: 0 }])).toBeUndefined();
    expect(pickFace([])).toBeUndefined();
  });
});

describe('Framer', () => {
  const settle = (framer: Framer, from: number, ms: number): Rect => {
    let crop = framer.crop(from);
    for (let t = from; t <= from + ms; t += 33) crop = framer.crop(t);
    return crop;
  };

  it('starts on the full frame', () => {
    expect(new Framer(FRAME).crop(0)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });

  it('moves smoothly toward the face, not in one jump', () => {
    const framer = new Framer(FRAME);
    framer.crop(0);
    framer.observe(face(900, 300, 144), 0);
    const early = framer.crop(100); // after 100 ms it has moved only a part of the way
    const target = targetCrop(face(900, 300, 144), FRAME, P);
    expect(early.h).toBeLessThan(FRAME.h);
    expect(early.h).toBeGreaterThan(target.h);
    const done = settle(framer, 100, 5000);
    expect(done.h).toBeCloseTo(target.h, 0);
    expect(done.x).toBeCloseTo(target.x, 0);
  });

  it('ignores face jitter smaller than the dead zone', () => {
    const framer = new Framer(FRAME);
    framer.crop(0);
    framer.observe(face(640, 300, 144), 0);
    const settled = settle(framer, 0, 4000);
    for (let i = 0; i < 20; i++) {
      framer.observe(face(640 + (i % 2 ? 12 : -12), 300 + (i % 2 ? 8 : -8), 144), 4000 + i * 100);
    }
    const after = settle(framer, 6000, 4000);
    expect(after.x).toBeCloseTo(settled.x, 1);
    expect(after.y).toBeCloseTo(settled.y, 1);
    expect(after.h).toBeCloseTo(settled.h, 1);
  });

  it('follows a real move of the face', () => {
    const framer = new Framer(FRAME);
    framer.crop(0);
    framer.observe(face(500, 300, 144), 0);
    const first = settle(framer, 0, 4000);
    framer.observe(face(800, 300, 144), 4000);
    const second = settle(framer, 4000, 4000);
    expect(second.x).toBeGreaterThan(first.x + 100);
  });

  it('holds the framing for a while without a face, then eases back to the full frame', () => {
    const framer = new Framer(FRAME);
    framer.crop(0);
    framer.observe(face(640, 300, 144), 0);
    const framed = settle(framer, 0, 4000);
    expect(framed.h).toBeLessThan(FRAME.h);
    framer.observe(face(640, 300, 144), 4000); // still there at t=4 s

    framer.observe(undefined, 4000 + P.holdMs - 100); // lost just now: keep the framing
    const held = settle(framer, 4000, 1000);
    expect(held.h).toBeCloseTo(framed.h, 0);

    framer.observe(undefined, 4000 + P.holdMs + 100); // lost for good: back to the whole frame
    const out = settle(framer, 7000, 5000);
    expect(out.h).toBeCloseTo(FRAME.h, 0);
    expect(out.x).toBeCloseTo(0, 0);
  });

  it('is safe with no time passing and with a clock that goes back', () => {
    const framer = new Framer(FRAME);
    framer.observe(face(640, 300, 144), 100);
    const a = framer.crop(100);
    const b = framer.crop(100);
    const c = framer.crop(50);
    for (const r of [a, b, c]) {
      expect(Number.isFinite(r.x + r.y + r.w + r.h)).toBe(true);
    }
    expect(b).toEqual(a);
  });
});
