import type { PcmChunkMessage } from './pcm-tap.worklet';
import pcmTapUrl from './pcm-tap.worklet.ts?worker&url';

export interface MixerInput {
  readonly id: 'microphone' | 'systemAudio';
  readonly track: MediaStreamTrack;
}

/**
 * Mixes microphone and system/tab audio with Web Audio and taps the result
 * as planar PCM chunks (via an AudioWorklet) for WebCodecs encoding.
 * Also exposes the mix as a MediaStream for preview/recording.
 */
export class WebAudioMixer {
  private readonly gains = new Map<MixerInput['id'], GainNode>();

  private constructor(
    private readonly context: AudioContext,
    private readonly tap: AudioWorkletNode,
    private readonly destination: MediaStreamAudioDestinationNode,
  ) {}

  /**
   * Prefers the requested sample rate; falls back to the device rate when the
   * browser refuses to connect sources across sample rates (Firefox).
   */
  static async create(
    inputs: readonly MixerInput[],
    sampleRate: number,
    channels: number,
    onPcm: (planes: Float32Array[], frames: number, sampleRate: number) => void,
  ): Promise<WebAudioMixer> {
    try {
      return await WebAudioMixer.build(
        new AudioContext({ sampleRate, latencyHint: 'interactive' }),
        inputs,
        channels,
        onPcm,
      );
    } catch {
      return WebAudioMixer.build(
        new AudioContext({ latencyHint: 'interactive' }),
        inputs,
        channels,
        onPcm,
      );
    }
  }

  private static async build(
    context: AudioContext,
    inputs: readonly MixerInput[],
    channels: number,
    onPcm: (planes: Float32Array[], frames: number, sampleRate: number) => void,
  ): Promise<WebAudioMixer> {
    try {
      await context.audioWorklet.addModule(pcmTapUrl);
      const tap = new AudioWorkletNode(context, 'pcm-tap', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: channels,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { chunkFrames: Math.round(context.sampleRate / 50), channels },
      });
      tap.port.onmessage = (event: MessageEvent<PcmChunkMessage>) =>
        onPcm(event.data.planes, event.data.frames, context.sampleRate);

      // A silent sink keeps the graph pulled (and the tap running) without audible output.
      const mute = context.createGain();
      mute.gain.value = 0;
      tap.connect(mute).connect(context.destination);

      const destination = context.createMediaStreamDestination();
      const mixer = new WebAudioMixer(context, tap, destination);
      for (const input of inputs) {
        const source = context.createMediaStreamSource(new MediaStream([input.track]));
        const gain = context.createGain();
        source.connect(gain);
        gain.connect(tap);
        gain.connect(destination);
        mixer.gains.set(input.id, gain);
      }
      await context.resume();
      return mixer;
    } catch (error) {
      await context.close().catch(() => undefined);
      throw error;
    }
  }

  get sampleRate(): number {
    return this.context.sampleRate;
  }

  get stream(): MediaStream {
    return this.destination.stream;
  }

  setGain(id: MixerInput['id'], value: number): void {
    const gain = this.gains.get(id);
    if (gain) gain.gain.setTargetAtTime(value, this.context.currentTime, 0.02);
  }

  async close(): Promise<void> {
    this.tap.port.onmessage = null;
    this.tap.disconnect();
    await this.context.close().catch(() => undefined);
  }
}
