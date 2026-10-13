import { describe, expect, it } from 'vitest';
import { AudioTimeline } from '../../src/domain/audio-timeline';
import { KeyframeScheduler } from '../../src/domain/keyframe-scheduler';
import { MediaClock } from '../../src/domain/media-clock';

describe('MediaClock', () => {
  it('reports microseconds since start and never goes backwards', () => {
    let now = 1_000;
    const clock = new MediaClock({ nowMs: () => now });
    expect(clock.started).toBe(false);
    expect(() => clock.nowUs()).toThrow();
    clock.start();
    now = 1_010.5;
    expect(clock.nowUs()).toBe(10_500);
    now = 1_005; // source jitter backwards
    expect(clock.nowUs()).toBe(10_500);
  });

  it('keeps its origin when started twice', () => {
    let now = 0;
    const clock = new MediaClock({ nowMs: () => now });
    clock.start();
    now = 50;
    clock.start();
    expect(clock.nowUs()).toBe(50_000);
  });
});

describe('AudioTimeline', () => {
  it('derives timestamps from sample counts, ignoring arrival jitter', () => {
    const timeline = new AudioTimeline(48_000);
    expect(timeline.next(960, 100_000)).toBe(100_000);
    expect(timeline.next(960, 125_000)).toBe(120_000); // arrived 5 ms late
    expect(timeline.next(960, 138_000)).toBe(140_000); // arrived 2 ms early
    expect(timeline.durationUs(960)).toBe(20_000);
  });

  it('re-anchors to the session clock when drift exceeds the threshold', () => {
    const timeline = new AudioTimeline(48_000, 40_000);
    timeline.next(960, 0);
    // A 500 ms gap (e.g. throttled tab): follow the clock instead of the sample count.
    expect(timeline.next(960, 520_000)).toBe(520_000);
    expect(timeline.next(960, 540_000)).toBe(540_000);
  });

  it('never overlaps audio already emitted when the clock lags the sample count', () => {
    const timeline = new AudioTimeline(48_000, 10_000);
    timeline.next(48_000, 0); // 1 s of audio delivered in one chunk
    expect(timeline.next(960, 20_000)).toBe(1_000_000);
    expect(timeline.next(960, 40_000)).toBe(1_020_000);
  });

  it('rejects invalid sample rates', () => {
    expect(() => new AudioTimeline(0)).toThrow(RangeError);
  });
});

describe('KeyframeScheduler', () => {
  it('forces the first frame, then one per interval', () => {
    const scheduler = new KeyframeScheduler(2_000_000);
    expect(scheduler.shouldForceKeyframe(0)).toBe(true);
    expect(scheduler.shouldForceKeyframe(1_000_000)).toBe(false);
    expect(scheduler.shouldForceKeyframe(1_999_999)).toBe(false);
    expect(scheduler.shouldForceKeyframe(2_000_000)).toBe(true);
    expect(scheduler.shouldForceKeyframe(2_033_333)).toBe(false);
  });

  it('honours on-demand requests and restarts the interval', () => {
    const scheduler = new KeyframeScheduler(2_000_000);
    scheduler.shouldForceKeyframe(0);
    scheduler.request();
    expect(scheduler.shouldForceKeyframe(500_000)).toBe(true);
    expect(scheduler.shouldForceKeyframe(2_000_000)).toBe(false);
    expect(scheduler.shouldForceKeyframe(2_500_000)).toBe(true);
  });

  it('rejects non-positive intervals', () => {
    expect(() => new KeyframeScheduler(0)).toThrow(RangeError);
  });
});
