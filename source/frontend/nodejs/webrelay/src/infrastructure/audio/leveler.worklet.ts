/**
 * AudioWorklet processor for the voice leveler (see leveler-dsp.ts for the algorithm).
 * Runs in AudioWorkletGlobalScope (no DOM); bundled separately by Vite.
 */
import { Leveler } from './leveler-dsp';

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

declare const sampleRate: number;

declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

const CHANNELS = 2;

class VoiceLevelerProcessor extends AudioWorkletProcessor {
  private readonly leveler = new Leveler(sampleRate, CHANNELS);

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output || !input[0]) return true; // nothing connected yet
    this.leveler.process(input, output);
    return true;
  }
}

registerProcessor('voice-leveler', VoiceLevelerProcessor);
