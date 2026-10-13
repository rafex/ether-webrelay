/**
 * Derives audio timestamps from the number of samples produced rather than
 * from wall-clock arrival time, which jitters with main-thread scheduling.
 * The timeline is anchored to the session clock and re-anchored when the two
 * drift apart (device clock skew, dropped buffers, tab throttling).
 */
export class AudioTimeline {
  private anchorUs: number | undefined;
  private samples = 0;
  private lastEndUs = 0;

  constructor(
    readonly sampleRate: number,
    readonly maxDriftUs = 40_000,
  ) {
    if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
      throw new RangeError(`invalid sample rate: ${sampleRate}`);
    }
  }

  /**
   * @param frames number of sample frames in the chunk
   * @param clockUs session-clock time at which the chunk was captured
   * @returns presentation timestamp (µs) for the first sample of the chunk
   */
  next(frames: number, clockUs: number): number {
    if (this.anchorUs === undefined) this.reanchor(clockUs);
    let timestamp = this.expectedUs();
    if (Math.abs(clockUs - timestamp) > this.maxDriftUs) {
      this.reanchor(clockUs);
      timestamp = this.expectedUs();
    }
    // Never overlap audio already emitted (clock lagging the sample count).
    timestamp = Math.max(timestamp, this.lastEndUs);
    this.lastEndUs = timestamp + this.durationUs(frames);
    this.samples += frames;
    return timestamp;
  }

  durationUs(frames: number): number {
    return Math.round((frames * 1_000_000) / this.sampleRate);
  }

  private expectedUs(): number {
    return (this.anchorUs ?? 0) + Math.round((this.samples * 1_000_000) / this.sampleRate);
  }

  private reanchor(clockUs: number): void {
    this.anchorUs = clockUs;
    this.samples = 0;
  }
}
