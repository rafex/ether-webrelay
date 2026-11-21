/**
 * Cuts a live microphone stream into utterances for a speech engine. It listens to the level of
 * 16 kHz blocks, notices when somebody starts talking, hands out the audio so far every so often
 * (an "interim" decode: the caption grows while the person speaks) and the whole utterance once
 * they pause (the "final" decode). Silence is never decoded: small engines make text up from noise.
 *
 * Time is the audio's own time (block lengths), never a clock, so it is deterministic and tested
 * with synthetic blocks.
 */

export interface SegmenterParams {
  readonly sampleRate: number;
  /** A block this loud (RMS, 0..1) counts as speech, at least. */
  readonly speechRms: number;
  /** ...and at least this many times the noise floor (the quietest block of the last few seconds). */
  readonly floorMultiplier: number;
  /** The noise floor is looked for in this much recent audio. */
  readonly floorWindowMs: number;
  /** A floor above this is not noise, it is somebody talking without a pause: ignore the excess. */
  readonly floorCap: number;
  /** Speech must last this long before an utterance starts (a click or a cough is not one). */
  readonly startMs: number;
  /** Audio before the start that is kept, so the first syllable is not cut. */
  readonly prerollMs: number;
  /** Silence this long ends the utterance. */
  readonly endSilenceMs: number;
  /** While speaking, hand out the audio so far this often. */
  readonly interimEveryMs: number;
  /** Less speech than this in an utterance is discarded. */
  readonly minSpeechMs: number;
  /** Longest utterance; at this length it is closed and a new one begins. */
  readonly maxUtteranceMs: number;
  /** Silence kept at the end of a closed utterance. */
  readonly tailMs: number;
}

export const DEFAULT_SEGMENTER: SegmenterParams = {
  sampleRate: 16_000,
  speechRms: 0.012,
  floorMultiplier: 3,
  floorWindowMs: 5_000,
  floorCap: 0.015,
  startMs: 160,
  prerollMs: 320,
  endSilenceMs: 700,
  interimEveryMs: 1_200,
  minSpeechMs: 400,
  maxUtteranceMs: 12_000,
  tailMs: 200,
};

export interface Utterance {
  /** 16 kHz mono samples. */
  readonly audio: Float32Array;
  /** True when the person paused (or the utterance hit the limit): this text will not grow. */
  readonly final: boolean;
}

const rms = (block: Float32Array): number => {
  if (block.length === 0) return 0;
  let sum = 0;
  for (const sample of block) sum += sample * sample;
  return Math.sqrt(sum / block.length);
};

const join = (blocks: readonly Float32Array[], drop = 0): Float32Array => {
  const total = blocks.reduce((n, b) => n + b.length, 0) - drop;
  const out = new Float32Array(Math.max(0, total));
  let at = 0;
  for (const block of blocks) {
    const room = out.length - at;
    if (room <= 0) break;
    out.set(room < block.length ? block.subarray(0, room) : block, at);
    at += Math.min(block.length, room);
  }
  return out;
};

export class SpeechSegmenter {
  private readonly levels: number[] = [];
  private speaking = false;
  private preroll: Float32Array[] = [];
  private prerollSamples = 0;
  private candidateMs = 0;
  private blocks: Float32Array[] = [];
  private bufferMs = 0;
  private speechMs = 0;
  private silenceMs = 0;
  private sinceInterimMs = 0;

  constructor(private readonly params: SegmenterParams = DEFAULT_SEGMENTER) {}

  /** Feeds the next block; returns the utterances (0, 1 or 2) that are ready to decode. */
  push(block: Float32Array): Utterance[] {
    const ms = (block.length / this.params.sampleRate) * 1000;
    const level = rms(block);
    // Minimum statistics: speech has pauses, steady noise does not, so the quietest block of the
    // last seconds is the noise (and a fan or a hiss never counts as somebody talking).
    this.levels.push(level);
    const keep = Math.max(1, Math.round(this.params.floorWindowMs / ms));
    if (this.levels.length > keep) this.levels.splice(0, this.levels.length - keep);
    const floor = Math.min(Math.min(...this.levels), this.params.floorCap);
    const loud = level >= Math.max(this.params.speechRms, floor * this.params.floorMultiplier);
    return this.speaking ? this.whileSpeaking(block, ms, loud) : this.whileIdle(block, ms, loud);
  }

  private whileIdle(block: Float32Array, ms: number, loud: boolean): Utterance[] {
    this.remember(block);
    this.candidateMs = loud ? this.candidateMs + ms : 0;
    if (this.candidateMs < this.params.startMs) return [];
    this.speaking = true;
    this.blocks = this.preroll;
    this.bufferMs = (this.prerollSamples / this.params.sampleRate) * 1000;
    this.speechMs = this.candidateMs;
    this.silenceMs = 0;
    this.sinceInterimMs = 0;
    this.preroll = [];
    this.prerollSamples = 0;
    this.candidateMs = 0;
    return [];
  }

  private whileSpeaking(block: Float32Array, ms: number, loud: boolean): Utterance[] {
    this.blocks.push(block);
    this.bufferMs += ms;
    this.sinceInterimMs += ms;
    if (loud) {
      this.speechMs += ms;
      this.silenceMs = 0;
    } else {
      this.silenceMs += ms;
    }

    if (this.silenceMs >= this.params.endSilenceMs) {
      const done = this.close();
      this.reset();
      return done ? [done] : [];
    }
    if (this.bufferMs >= this.params.maxUtteranceMs) {
      const done = this.close();
      const tail = this.blocks;
      this.reset();
      for (const kept of tail) this.remember(kept); // the next utterance starts with a little context
      return done ? [done] : [];
    }
    if (
      this.sinceInterimMs >= this.params.interimEveryMs &&
      this.speechMs >= this.params.minSpeechMs
    ) {
      this.sinceInterimMs = 0;
      return [{ audio: join(this.blocks), final: false }];
    }
    return [];
  }

  /** The finished utterance, or undefined when it held too little speech to be worth decoding. */
  private close(): Utterance | undefined {
    if (this.speechMs < this.params.minSpeechMs) return undefined;
    const extraSilence = Math.max(0, this.silenceMs - this.params.tailMs);
    const drop = Math.round((extraSilence / 1000) * this.params.sampleRate);
    return { audio: join(this.blocks, drop), final: true };
  }

  private reset(): void {
    this.speaking = false;
    this.blocks = [];
    this.bufferMs = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.sinceInterimMs = 0;
    this.candidateMs = 0;
    this.preroll = [];
    this.prerollSamples = 0;
  }

  /** Keeps the last prerollMs of audio while idle. */
  private remember(block: Float32Array): void {
    this.preroll.push(block);
    this.prerollSamples += block.length;
    const keep = Math.round((this.params.prerollMs / 1000) * this.params.sampleRate);
    while (
      this.preroll.length > 1 &&
      this.prerollSamples - (this.preroll[0]?.length ?? 0) >= keep
    ) {
      this.prerollSamples -= this.preroll.shift()?.length ?? 0;
    }
  }
}
