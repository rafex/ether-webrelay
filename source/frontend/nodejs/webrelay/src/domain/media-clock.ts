/** Monotonic millisecond source, e.g. `performance.now()`. */
export interface TimeSource {
  nowMs(): number;
}

/**
 * Single session clock shared by audio and video so the bridge can interleave
 * both tracks on one timeline. Timestamps are microseconds since `start()` and
 * never decrease, even across reconnections (the clock outlives the socket).
 */
export class MediaClock {
  private originMs: number | undefined;
  private lastUs = 0;

  constructor(private readonly source: TimeSource) {}

  get started(): boolean {
    return this.originMs !== undefined;
  }

  start(): void {
    this.originMs ??= this.source.nowMs();
  }

  nowUs(): number {
    if (this.originMs === undefined) {
      throw new Error('MediaClock.nowUs() called before start()');
    }
    const us = Math.round((this.source.nowMs() - this.originMs) * 1000);
    this.lastUs = Math.max(this.lastUs, us);
    return this.lastUs;
  }
}
