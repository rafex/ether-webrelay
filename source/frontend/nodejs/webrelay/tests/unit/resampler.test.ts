import { describe, expect, it } from 'vitest';
import { Resampler } from '../../src/domain/resampler';

const sine = (rate: number, hz: number, seconds: number): Float32Array =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) =>
    Math.sin((2 * Math.PI * hz * i) / rate),
  );

describe('Resampler', () => {
  it('passes audio through unchanged at the same rate (as a copy)', () => {
    const input = Float32Array.of(0.1, -0.2, 0.3);
    const output = new Resampler(16_000, 16_000).process(input);
    expect([...output]).toEqual([...input]);
    expect(output).not.toBe(input);
  });

  it('turns 48 kHz into 16 kHz: a third of the samples, the same tone', () => {
    const out = new Resampler(48_000, 16_000).process(sine(48_000, 440, 1));
    expect(out.length).toBe(16_000);
    // 440 Hz crosses zero upward ~440 times in a second.
    let crossings = 0;
    for (let i = 1; i < out.length; i++)
      if ((out[i - 1] ?? 0) < 0 && (out[i] ?? 0) >= 0) crossings++;
    expect(crossings).toBeGreaterThanOrEqual(438);
    expect(crossings).toBeLessThanOrEqual(442);
  });

  it('handles a non-integer ratio (44.1 kHz → 16 kHz)', () => {
    const out = new Resampler(44_100, 16_000).process(sine(44_100, 300, 1));
    expect(Math.abs(out.length - 16_000)).toBeLessThanOrEqual(1);
  });

  it('joins consecutive blocks seamlessly: chunked equals whole', () => {
    const input = sine(44_100, 300, 0.5);
    const whole = new Resampler(44_100, 16_000).process(input);
    const chunked = new Resampler(44_100, 16_000);
    const parts: number[] = [];
    for (let at = 0; at < input.length; at += 128) {
      parts.push(...chunked.process(input.subarray(at, at + 128)));
    }
    expect(parts.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) expect(parts[i]).toBeCloseTo(whole[i] ?? 0, 5);
  });

  it('attenuates what is above the new Nyquist (averaging is a low-pass)', () => {
    // 14 kHz at 48 kHz sampling is above 8 kHz: it must not come out at full strength.
    const out = new Resampler(48_000, 16_000).process(sine(48_000, 14_000, 0.2));
    const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeLessThan(0.6);
  });

  it('rejects impossible rates', () => {
    expect(() => new Resampler(0, 16_000)).toThrow(RangeError);
    expect(() => new Resampler(48_000, -1)).toThrow(RangeError);
  });
});
