/**
 * Forces a keyframe at a fixed GOP interval (RTMPS ingests such as YouTube
 * and Twitch expect one every ≤ 2–4 s) and on demand (reconnection, bridge
 * request, congestion recovery).
 */
export class KeyframeScheduler {
  private lastKeyframeUs: number | undefined;
  private pending = true;

  constructor(readonly intervalUs: number) {
    if (!(intervalUs > 0)) throw new RangeError(`invalid keyframe interval: ${intervalUs}`);
  }

  request(): void {
    this.pending = true;
  }

  /** Returns whether the frame at `timestampUs` must be encoded as a keyframe. */
  shouldForceKeyframe(timestampUs: number): boolean {
    const due =
      this.pending ||
      this.lastKeyframeUs === undefined ||
      timestampUs - this.lastKeyframeUs >= this.intervalUs;
    if (due) {
      this.pending = false;
      this.lastKeyframeUs = timestampUs;
    }
    return due;
  }
}
