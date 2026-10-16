/**
 * Voice leveler: pure DSP, no Web Audio types, so it runs in the AudioWorklet and in tests.
 *
 * Two stages, one after the other:
 *  1. A slow level control. It measures the voice level (RMS over ~50 ms) and moves a gain
 *     towards a target level: quickly down when someone is too loud, slowly up when they are
 *     too quiet. It only moves while there is a voice (above `gateDb`); in pauses the gain is
 *     held, so a quiet room is never lifted between phrases.
 *  2. A look-ahead peak limiter. The audio is delayed a few milliseconds so the gain can
 *     already be going down when a peak arrives, instead of clipping it.
 */

export interface LevelerSettings {
  /** Level the voice is brought towards (RMS, dBFS). */
  readonly targetDb: number;
  readonly maxBoostDb: number;
  readonly maxCutDb: number;
  /** Below this level the gain is held (silence, room noise). */
  readonly gateDb: number;
  /** Time constant of the level detector. */
  readonly levelMs: number;
  /** Time constant when the gain goes down (voice too loud). */
  readonly attackMs: number;
  /** Time constant when the gain goes up (voice too quiet). */
  readonly releaseMs: number;
  /** Highest sample value the output may reach (dBFS). */
  readonly ceilingDb: number;
  readonly lookaheadMs: number;
  /** Time constant with which the limiter lets go after a peak. */
  readonly limiterReleaseMs: number;
}

export const DEFAULT_LEVELER: LevelerSettings = {
  targetDb: -20,
  maxBoostDb: 12,
  maxCutDb: 12,
  gateDb: -45,
  levelMs: 50,
  attackMs: 30,
  releaseMs: 800,
  ceilingDb: -2,
  lookaheadMs: 5,
  limiterReleaseMs: 80,
};

const dbToLinear = (db: number) => 10 ** (db / 20);
const coefficient = (ms: number, sampleRate: number) =>
  1 - Math.exp(-1 / ((ms / 1000) * sampleRate));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export class Leveler {
  /** Samples of delay the limiter adds (the look-ahead). */
  readonly latencyFrames: number;

  private readonly s: LevelerSettings;
  private readonly levelCoef: number;
  private readonly attackCoef: number;
  private readonly releaseCoef: number;
  private readonly limiterAttackCoef: number;
  private readonly limiterReleaseCoef: number;
  private readonly ceiling: number;

  private power = 0;
  private gainDb = 0;
  private limiterGain = 1;

  // Delay line per channel and a monotonic deque giving the peak of the last `latency + 1` samples.
  private readonly delay: Float32Array[];
  private writeIndex = 0;
  private readonly delayed: Float32Array;
  private readonly dequeValues: Float32Array;
  private readonly dequeIndexes: Float64Array;
  private dequeHead = 0;
  private dequeTail = 0;
  private sampleCounter = 0;

  constructor(
    sampleRate: number,
    private readonly channels: number,
    settings: LevelerSettings = DEFAULT_LEVELER,
  ) {
    this.s = settings;
    this.latencyFrames = Math.max(1, Math.round((settings.lookaheadMs / 1000) * sampleRate));
    this.levelCoef = coefficient(settings.levelMs, sampleRate);
    this.attackCoef = coefficient(settings.attackMs, sampleRate);
    this.releaseCoef = coefficient(settings.releaseMs, sampleRate);
    // The gain must reach the needed value within the look-ahead: ~4 time constants.
    this.limiterAttackCoef = coefficient(settings.lookaheadMs / 4, sampleRate);
    this.limiterReleaseCoef = coefficient(settings.limiterReleaseMs, sampleRate);
    this.ceiling = dbToLinear(settings.ceilingDb);
    this.delayed = new Float32Array(channels);
    this.delay = Array.from({ length: channels }, () => new Float32Array(this.latencyFrames));
    const window = this.latencyFrames + 1;
    this.dequeValues = new Float32Array(window + 1);
    this.dequeIndexes = new Float64Array(window + 1);
  }

  /** Current level-stage gain in dB (for tests and diagnostics). */
  get levelGainDb(): number {
    return this.gainDb;
  }

  /**
   * Processes one block. `input` and `output` have one array per channel, all of the same
   * length; they may be the same arrays.
   */
  process(input: readonly Float32Array[], output: readonly Float32Array[]): void {
    const frames = input[0]?.length ?? 0;
    const capacity = this.dequeValues.length;
    const latency = this.latencyFrames;
    for (let n = 0; n < frames; n++) {
      // --- stage 1: level control ---------------------------------------------------------
      let meanSquare = 0;
      for (let c = 0; c < this.channels; c++) {
        const x = input[c]?.[n] ?? 0;
        meanSquare += x * x;
      }
      meanSquare /= this.channels;
      this.power += (meanSquare - this.power) * this.levelCoef;
      const levelDb = 10 * Math.log10(this.power + 1e-12);
      if (levelDb > this.s.gateDb) {
        const desired = clamp(this.s.targetDb - levelDb, -this.s.maxCutDb, this.s.maxBoostDb);
        const coef = desired < this.gainDb ? this.attackCoef : this.releaseCoef;
        this.gainDb += (desired - this.gainDb) * coef;
      }
      const gain = dbToLinear(this.gainDb);

      // --- stage 2: look-ahead limiter ----------------------------------------------------
      let peak = 0;
      const slot = this.writeIndex;
      for (let c = 0; c < this.channels; c++) {
        const y = (input[c]?.[n] ?? 0) * gain;
        const line = this.delay[c] as Float32Array;
        // Read the delayed sample before overwriting the slot it lives in.
        this.delayed[c] = line[slot] as number;
        line[slot] = y;
        peak = Math.max(peak, Math.abs(y));
      }

      // Sliding maximum of the last `latency + 1` peaks.
      while (
        this.dequeTail !== this.dequeHead &&
        (this.dequeValues[(this.dequeTail - 1 + capacity) % capacity] as number) <= peak
      ) {
        this.dequeTail = (this.dequeTail - 1 + capacity) % capacity;
      }
      this.dequeValues[this.dequeTail] = peak;
      this.dequeIndexes[this.dequeTail] = this.sampleCounter;
      this.dequeTail = (this.dequeTail + 1) % capacity;
      while (
        (this.dequeIndexes[this.dequeHead] as number) <= this.sampleCounter - (latency + 1) &&
        this.dequeHead !== this.dequeTail
      ) {
        this.dequeHead = (this.dequeHead + 1) % capacity;
      }
      const envelope = this.dequeValues[this.dequeHead] as number;

      const needed = envelope > this.ceiling ? this.ceiling / envelope : 1;
      const coef = needed < this.limiterGain ? this.limiterAttackCoef : this.limiterReleaseCoef;
      this.limiterGain += (needed - this.limiterGain) * coef;

      const hardLimit = this.ceiling * 1.04; // the smoothing can overshoot a hair; never beyond this
      for (let c = 0; c < this.channels; c++) {
        const out = output[c];
        if (out) {
          out[n] = clamp((this.delayed[c] ?? 0) * this.limiterGain, -hardLimit, hardLimit);
        }
      }
      this.writeIndex = (slot + 1) % latency;
      this.sampleCounter++;
    }
  }
}
