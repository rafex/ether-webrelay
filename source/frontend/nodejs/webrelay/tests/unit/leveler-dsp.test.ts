import { describe, expect, it } from 'vitest';
import { DEFAULT_LEVELER, Leveler } from '../../src/infrastructure/audio/leveler-dsp';

const RATE = 48_000;
const BLOCK = 128;
const db = (ratio: number) => 20 * Math.log10(ratio);

/** Runs `seconds` of a sine through the leveler; returns the output and the leveler. */
function runSine(amplitude: number, seconds: number, channels = 2) {
  const leveler = new Leveler(RATE, channels);
  const total = Math.round(seconds * RATE);
  const output = Array.from({ length: channels }, () => new Float32Array(total));
  for (let start = 0; start < total; start += BLOCK) {
    const frames = Math.min(BLOCK, total - start);
    const input = Array.from({ length: channels }, () => new Float32Array(frames));
    for (let n = 0; n < frames; n++) {
      const x = amplitude * Math.sin((2 * Math.PI * 220 * (start + n)) / RATE);
      for (const plane of input) plane[n] = x;
    }
    const out = output.map((plane) => plane.subarray(start, start + frames));
    leveler.process(input, out);
  }
  return { leveler, output };
}

const peak = (plane: Float32Array, from = 0) => {
  let max = 0;
  for (let i = from; i < plane.length; i++) max = Math.max(max, Math.abs(plane[i] as number));
  return max;
};

describe('Leveler', () => {
  it('never lets a hot signal past the ceiling, not even while the gain settles', () => {
    const { output } = runSine(0.99, 2);
    const ceiling = 10 ** (DEFAULT_LEVELER.ceilingDb / 20);
    expect(peak(output[0] as Float32Array)).toBeLessThanOrEqual(ceiling * 1.04 + 1e-6);
  });

  it('brings a quiet voice up, but never beyond the boost limit', () => {
    const { leveler, output } = runSine(0.02, 10); // about -37 dBFS RMS
    expect(leveler.levelGainDb).toBeGreaterThan(DEFAULT_LEVELER.maxBoostDb - 0.5);
    expect(leveler.levelGainDb).toBeLessThanOrEqual(DEFAULT_LEVELER.maxBoostDb + 1e-6);
    const tail = output[0] as Float32Array;
    expect(db(peak(tail, tail.length - RATE) / 0.02)).toBeGreaterThan(
      DEFAULT_LEVELER.maxBoostDb - 1,
    );
  });

  it('holds the gain below the gate, so a quiet room is not lifted', () => {
    const { leveler, output } = runSine(0.0005, 5); // about -69 dBFS RMS
    expect(leveler.levelGainDb).toBe(0);
    expect(peak(output[0] as Float32Array, RATE)).toBeCloseTo(0.0005, 4);
  });

  it('brings a loud voice down towards the target', () => {
    const { leveler } = runSine(0.5, 5); // about -9 dBFS RMS
    expect(leveler.levelGainDb).toBeLessThan(-6);
    expect(leveler.levelGainDb).toBeGreaterThanOrEqual(-DEFAULT_LEVELER.maxCutDb - 1e-6);
  });

  it('delays the signal by exactly the look-ahead and keeps channels in step', () => {
    const leveler = new Leveler(RATE, 2);
    const block = 1024; // longer than the look-ahead
    const input = [new Float32Array(block), new Float32Array(block)];
    (input[0] as Float32Array)[0] = 0.1;
    (input[1] as Float32Array)[0] = 0.1;
    const out = [new Float32Array(block), new Float32Array(block)];
    leveler.process(input, out);
    const left = out[0] as Float32Array;
    expect(left[leveler.latencyFrames]).toBeCloseTo(0.1, 3);
    expect(left[0]).toBe(0);
    expect(out[1]).toEqual(out[0]);
  });
});
