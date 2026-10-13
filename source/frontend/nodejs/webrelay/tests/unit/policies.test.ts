import { describe, expect, it } from 'vitest';
import { BackpressureGate } from '../../src/domain/backpressure';
import { ReconnectPolicy } from '../../src/domain/reconnect-policy';

const noJitter = { initialDelayMs: 100, maxDelayMs: 1_000, multiplier: 2, jitterRatio: 0 };

describe('ReconnectPolicy', () => {
  it('backs off exponentially up to the cap', () => {
    const policy = new ReconnectPolicy({ ...noJitter, maxAttempts: Infinity });
    const delays = Array.from({ length: 6 }, () => policy.nextDelayMs());
    expect(delays).toEqual([100, 200, 400, 800, 1_000, 1_000]);
    expect(policy.attempts).toBe(6);
  });

  it('gives up after maxAttempts and starts over after reset', () => {
    const policy = new ReconnectPolicy({ ...noJitter, maxAttempts: 2 });
    expect(policy.nextDelayMs()).toBe(100);
    expect(policy.nextDelayMs()).toBe(200);
    expect(policy.nextDelayMs()).toBeNull();
    policy.reset();
    expect(policy.nextDelayMs()).toBe(100);
  });

  it('applies bounded jitter', () => {
    const options = { ...noJitter, jitterRatio: 0.5, maxAttempts: 10 };
    expect(new ReconnectPolicy(options, () => 0).nextDelayMs()).toBe(50);
    expect(new ReconnectPolicy(options, () => 1).nextDelayMs()).toBe(150);
  });

  it('validates its options', () => {
    expect(() => new ReconnectPolicy({ ...noJitter, maxAttempts: 1, multiplier: 0.5 })).toThrow();
    expect(() => new ReconnectPolicy({ ...noJitter, maxAttempts: 1, jitterRatio: 2 })).toThrow();
    expect(() => new ReconnectPolicy({ ...noJitter, maxAttempts: 1, maxDelayMs: 10 })).toThrow();
  });
});

describe('BackpressureGate', () => {
  const HIGH = 1_000;
  const CRITICAL = 5_000;
  const gate = () =>
    new BackpressureGate({ highWaterMarkBytes: HIGH, criticalWaterMarkBytes: CRITICAL });
  const video = (keyframe = false) => ({ track: 'video' as const, keyframe });
  const audio = { track: 'audio' as const, keyframe: true };

  it('waits for a keyframe at start and flags it as a discontinuity', () => {
    const g = gate();
    expect(g.decide(video(), 0)).toEqual({
      send: false,
      requestKeyframe: true,
      discontinuity: false,
    });
    expect(g.decide(video(), 0)).toEqual({
      send: false,
      requestKeyframe: false,
      discontinuity: false,
    });
    expect(g.decide(video(true), 0)).toEqual({
      send: true,
      requestKeyframe: false,
      discontinuity: true,
    });
    expect(g.decide(video(), 0)).toEqual({
      send: true,
      requestKeyframe: false,
      discontinuity: false,
    });
  });

  it('drops delta frames under congestion and resumes only on a keyframe', () => {
    const g = gate();
    g.decide(video(true), 0);
    expect(g.decide(video(), HIGH).send).toBe(false);
    // Socket drained, but the reference chain is broken: still drop, and ask for a keyframe.
    expect(g.decide(video(), 0)).toEqual({
      send: false,
      requestKeyframe: true,
      discontinuity: false,
    });
    expect(g.decide(video(true), 0).send).toBe(true);
  });

  it('re-requests a keyframe that was itself dropped by congestion', () => {
    const g = gate();
    g.decide(video(true), 0);
    g.decide(video(), 0);
    expect(g.decide(video(), HIGH).send).toBe(false);
    expect(g.decide(video(), 0).requestKeyframe).toBe(true);
    expect(g.decide(video(true), HIGH).send).toBe(false); // the requested keyframe is lost
    expect(g.decide(video(), 0).requestKeyframe).toBe(true);
  });

  it('keeps audio flowing until the critical watermark', () => {
    const g = gate();
    expect(g.decide(audio, 0)).toEqual({ send: true, requestKeyframe: false, discontinuity: true });
    expect(g.decide(audio, HIGH * 2).send).toBe(true);
    expect(g.decide(audio, CRITICAL).send).toBe(false);
    expect(g.decide(audio, 0).discontinuity).toBe(true);
  });

  it('reset() restarts the keyframe wait and the discontinuity flags', () => {
    const g = gate();
    g.decide(video(true), 0);
    g.decide(audio, 0);
    g.reset();
    expect(g.decide(video(), 0).send).toBe(false);
    expect(g.decide(video(true), 0).discontinuity).toBe(true);
    expect(g.decide(audio, 0).discontinuity).toBe(true);
  });

  it('rejects a critical watermark below the high watermark', () => {
    expect(
      () => new BackpressureGate({ highWaterMarkBytes: 10, criticalWaterMarkBytes: 5 }),
    ).toThrow(RangeError);
  });
});
