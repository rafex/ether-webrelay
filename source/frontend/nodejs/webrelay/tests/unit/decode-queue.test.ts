import { describe, expect, it } from 'vitest';
import {
  DecodeQueue,
  MAX_WAITING_FINALS,
} from '../../src/infrastructure/transcription/decode-queue';

const audio = (n: number) => new Float32Array(n);

function setup() {
  const sent: { id: number; length: number }[] = [];
  const queue = new DecodeQueue((id, a) => sent.push({ id, length: a.length }));
  return { sent, queue };
}

describe('DecodeQueue', () => {
  it('sends the first utterance at once', () => {
    const { sent, queue } = setup();
    queue.offer({ audio: audio(10), final: false });
    expect(sent).toEqual([{ id: 1, length: 10 }]);
    expect(queue.busy).toBe(true);
  });

  it('drops a partial result while the engine is busy', () => {
    const { sent, queue } = setup();
    queue.offer({ audio: audio(10), final: false });
    queue.offer({ audio: audio(20), final: false });
    expect(sent).toHaveLength(1);
    queue.complete(1);
    expect(sent).toHaveLength(1);
    expect(queue.busy).toBe(false);
  });

  it('keeps a finished utterance and sends it when the engine is free', () => {
    const { sent, queue } = setup();
    queue.offer({ audio: audio(10), final: false });
    queue.offer({ audio: audio(30), final: true });
    expect(sent).toHaveLength(1);
    expect(queue.complete(1)).toEqual({ final: false });
    expect(sent[1]).toEqual({ id: 2, length: 30 });
    expect(queue.complete(2)).toEqual({ final: true });
    expect(queue.busy).toBe(false);
  });

  it('forgets the oldest finished utterance when too many wait', () => {
    const { sent, queue } = setup();
    queue.offer({ audio: audio(1), final: true });
    for (let i = 0; i < MAX_WAITING_FINALS + 2; i++)
      queue.offer({ audio: audio(100 + i), final: true });
    let id = 1;
    while (queue.busy) queue.complete(id++);
    const lengths = sent.map((s) => s.length);
    expect(lengths).toEqual([1, 102, 103, 104]);
  });

  it('ignores an answer for a job that is not the running one', () => {
    const { queue } = setup();
    queue.offer({ audio: audio(10), final: true });
    expect(queue.complete(99)).toBeUndefined();
    expect(queue.busy).toBe(true);
  });

  it('clear forgets running and waiting work', () => {
    const { sent, queue } = setup();
    queue.offer({ audio: audio(10), final: true });
    queue.offer({ audio: audio(20), final: true });
    queue.clear();
    expect(queue.busy).toBe(false);
    expect(queue.complete(1)).toBeUndefined();
    expect(sent).toHaveLength(1);
  });
});
