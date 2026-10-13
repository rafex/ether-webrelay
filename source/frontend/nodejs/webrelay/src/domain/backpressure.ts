export interface BackpressureOptions {
  /** Above this many queued bytes, non-key video frames are dropped. */
  readonly highWaterMarkBytes: number;
  /** Above this many queued bytes, audio is dropped too. */
  readonly criticalWaterMarkBytes: number;
}

export const DEFAULT_BACKPRESSURE: BackpressureOptions = {
  highWaterMarkBytes: 2 * 1024 * 1024,
  criticalWaterMarkBytes: 8 * 1024 * 1024,
};

export interface ChunkDescriptor {
  readonly track: 'video' | 'audio';
  readonly keyframe: boolean;
}

export interface GateDecision {
  readonly send: boolean;
  /** The encoder should emit a keyframe as soon as possible. */
  readonly requestKeyframe: boolean;
  /** First frame of its track after a gap; flag it as a discontinuity. */
  readonly discontinuity: boolean;
}

/**
 * Decides which encoded chunks go on the wire when the socket is congested.
 * Dropping a delta video frame corrupts every frame until the next keyframe,
 * so once video is dropped the gate waits for a keyframe before resuming.
 * Audio is cheap and perceptually critical, so it is only dropped in emergencies.
 */
export class BackpressureGate {
  private waitingForKeyframe = true;
  private keyframeRequested = false;
  private discontinuityPending = true;
  private audioDiscontinuityPending = true;

  constructor(private readonly options: BackpressureOptions = DEFAULT_BACKPRESSURE) {
    if (options.criticalWaterMarkBytes < options.highWaterMarkBytes) {
      throw new RangeError('criticalWaterMarkBytes must be >= highWaterMarkBytes');
    }
  }

  /** Call after a (re)connection or any gap in delivery. */
  reset(): void {
    this.waitingForKeyframe = true;
    this.keyframeRequested = false;
    this.discontinuityPending = true;
    this.audioDiscontinuityPending = true;
  }

  decide(chunk: ChunkDescriptor, bufferedBytes: number): GateDecision {
    if (chunk.track === 'audio') {
      if (bufferedBytes >= this.options.criticalWaterMarkBytes) {
        this.audioDiscontinuityPending = true;
        return { send: false, requestKeyframe: false, discontinuity: false };
      }
      const discontinuity = this.audioDiscontinuityPending;
      this.audioDiscontinuityPending = false;
      return { send: true, requestKeyframe: false, discontinuity };
    }

    const congested = bufferedBytes >= this.options.highWaterMarkBytes;
    if (chunk.keyframe && !congested) {
      const discontinuity = this.discontinuityPending;
      this.waitingForKeyframe = false;
      this.keyframeRequested = false;
      this.discontinuityPending = false;
      return { send: true, requestKeyframe: false, discontinuity };
    }
    if (!this.waitingForKeyframe && !congested) {
      return { send: true, requestKeyframe: false, discontinuity: false };
    }

    this.waitingForKeyframe = true;
    // A keyframe lost to congestion must be requested again once the socket drains.
    if (chunk.keyframe) this.keyframeRequested = false;
    // Ask once per gap; repeating the request while congested would only add load.
    const requestKeyframe = !congested && !this.keyframeRequested;
    if (requestKeyframe) this.keyframeRequested = true;
    return { send: false, requestKeyframe, discontinuity: false };
  }
}
