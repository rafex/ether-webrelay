/**
 * Streaming sample-rate conversion by area averaging: every output sample is the mean of the source
 * interval it covers. For downsampling (microphone 48 kHz → 16 kHz for the speech engine) the
 * averaging doubles as a cheap low-pass, which is all speech recognition needs. Pure, no browser
 * types, so it is tested without audio.
 */
export class Resampler {
  private readonly ratio: number; // source samples per output sample
  private sum = 0;
  private covered = 0;

  constructor(
    readonly fromRate: number,
    readonly toRate: number,
  ) {
    if (!(fromRate > 0) || !(toRate > 0)) throw new RangeError('sample rates must be positive');
    this.ratio = fromRate / toRate;
  }

  /** Converts the next block; state carries over so consecutive blocks join seamlessly. */
  process(input: Float32Array): Float32Array {
    if (this.fromRate === this.toRate) return input.slice();
    const out = new Float32Array(Math.ceil(input.length / this.ratio) + 1);
    let written = 0;
    for (let i = 0; i < input.length; i++) {
      const sample = input[i] ?? 0;
      let weight = 1;
      while (weight > 1e-9) {
        const take = Math.min(weight, this.ratio - this.covered);
        this.sum += sample * take;
        this.covered += take;
        weight -= take;
        if (this.covered >= this.ratio - 1e-9) {
          out[written++] = this.sum / this.ratio;
          this.sum = 0;
          this.covered = 0;
        }
      }
    }
    return out.slice(0, written);
  }
}
