import type { MediaTrackLike } from '../../ports/media';

/**
 * Microphone level for the lobby and the settings dialog, 0..1 (RMS with a
 * little gain so speech fills most of the bar). Not part of the sent audio path.
 */
export class AudioLevelMeter {
  private readonly context: AudioContext;
  private readonly analyser: AnalyserNode;
  private readonly samples: Float32Array<ArrayBuffer>;

  constructor(track: MediaTrackLike) {
    this.context = new AudioContext();
    const source = this.context.createMediaStreamSource(
      new MediaStream([track as MediaStreamTrack]),
    );
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 512;
    this.samples = new Float32Array(this.analyser.fftSize);
    source.connect(this.analyser);
  }

  level(): number {
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const sample of this.samples) sum += sample * sample;
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 4);
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
  }
}
