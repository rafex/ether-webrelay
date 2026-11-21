/**
 * AudioWorklet that turns the microphone into 100 ms blocks of 16 kHz mono audio for the speech
 * engine, whatever the context's own rate is. Runs in AudioWorkletGlobalScope (no DOM); bundled
 * separately by Vite.
 */
import { Resampler } from '../../domain/resampler';

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

declare const sampleRate: number;

declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

const TARGET_RATE = 16_000;
const BLOCK = TARGET_RATE / 10;

class CaptionCaptureProcessor extends AudioWorkletProcessor {
  private readonly resampler = new Resampler(sampleRate, TARGET_RATE);
  private readonly block = new Float32Array(BLOCK);
  private filled = 0;

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    const first = channels?.[0];
    if (!channels || !first) return true; // nothing connected yet
    let mono = first;
    if (channels.length > 1) {
      mono = new Float32Array(first.length);
      for (const channel of channels) {
        for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] ?? 0) + (channel[i] ?? 0);
      }
      for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] ?? 0) / channels.length;
    }
    const converted = this.resampler.process(mono);
    let at = 0;
    while (at < converted.length) {
      const n = Math.min(BLOCK - this.filled, converted.length - at);
      this.block.set(converted.subarray(at, at + n), this.filled);
      this.filled += n;
      at += n;
      if (this.filled === BLOCK) {
        const out = this.block.slice();
        this.port.postMessage(out, [out.buffer]);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('caption-capture', CaptionCaptureProcessor);
