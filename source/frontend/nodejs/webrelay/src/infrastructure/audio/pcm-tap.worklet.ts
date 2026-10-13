/**
 * AudioWorklet processor: taps the mixed signal and posts fixed-size chunks of
 * planar Float32 PCM to the main thread, where they become WebCodecs AudioData.
 * Runs in AudioWorkletGlobalScope (no DOM); bundled separately by Vite.
 */

interface PcmTapOptions {
  readonly processorOptions?: { readonly chunkFrames?: number; readonly channels?: number };
}

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: PcmTapOptions);
}

declare function registerProcessor(
  name: string,
  processor: new (options: PcmTapOptions) => AudioWorkletProcessor,
): void;

export interface PcmChunkMessage {
  readonly planes: Float32Array[];
  readonly frames: number;
}

class PcmTapProcessor extends AudioWorkletProcessor {
  private readonly chunkFrames: number;
  private readonly channels: number;
  private planes: Float32Array[];
  private filled = 0;

  constructor(options: PcmTapOptions) {
    super(options);
    this.chunkFrames = options.processorOptions?.chunkFrames ?? 960;
    this.channels = options.processorOptions?.channels ?? 2;
    this.planes = this.allocate();
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const first = input?.[0];
    if (!input || !first) return true; // nothing connected yet
    const frames = first.length;
    let offset = 0;
    while (offset < frames) {
      const count = Math.min(frames - offset, this.chunkFrames - this.filled);
      for (let channel = 0; channel < this.channels; channel++) {
        // Mono sources are up-mixed by duplicating the first channel.
        const source = input[channel] ?? first;
        this.planes[channel]?.set(source.subarray(offset, offset + count), this.filled);
      }
      this.filled += count;
      offset += count;
      if (this.filled === this.chunkFrames) this.flush();
    }
    return true;
  }

  private flush(): void {
    const message: PcmChunkMessage = { planes: this.planes, frames: this.chunkFrames };
    this.port.postMessage(
      message,
      this.planes.map((plane) => plane.buffer as ArrayBuffer),
    );
    this.planes = this.allocate();
    this.filled = 0;
  }

  private allocate(): Float32Array[] {
    return Array.from({ length: this.channels }, () => new Float32Array(this.chunkFrames));
  }
}

registerProcessor('pcm-tap', PcmTapProcessor);
