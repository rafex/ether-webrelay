import type { Utterance } from '../../domain/speech-segmenter';

/** At most this many finished utterances wait for the engine; beyond that the oldest is dropped. */
export const MAX_WAITING_FINALS = 3;

/**
 * One decode at a time. The engine is slower than a fast talker on a slow machine, so audio must
 * not pile up: a partial result (interim) is dropped if the engine is busy (the next one covers
 * it), while a finished utterance waits its turn, because its words are not coming again.
 */
export class DecodeQueue {
  private nextId = 1;
  private running: { id: number; final: boolean } | undefined;
  private waiting: Utterance[] = [];

  constructor(private readonly send: (id: number, audio: Float32Array) => void) {}

  get busy(): boolean {
    return this.running !== undefined;
  }

  offer(utterance: Utterance): void {
    if (!this.running) {
      this.start(utterance);
      return;
    }
    if (!utterance.final) return;
    this.waiting.push(utterance);
    if (this.waiting.length > MAX_WAITING_FINALS) this.waiting.shift();
  }

  /** The engine answered job `id`: returns what it was, and sends the next waiting one. */
  complete(id: number): { final: boolean } | undefined {
    const done = this.running;
    if (!done || done.id !== id) return undefined;
    this.running = undefined;
    const next = this.waiting.shift();
    if (next) this.start(next);
    return { final: done.final };
  }

  /** Forget everything (the session ended). */
  clear(): void {
    this.running = undefined;
    this.waiting = [];
  }

  private start(utterance: Utterance): void {
    const id = this.nextId++;
    this.running = { id, final: utterance.final };
    this.send(id, utterance.audio);
  }
}
