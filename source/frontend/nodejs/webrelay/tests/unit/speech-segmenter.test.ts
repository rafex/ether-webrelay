import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEGMENTER,
  SpeechSegmenter,
  type Utterance,
} from '../../src/domain/speech-segmenter';

const BLOCK = 1600; // 100 ms at 16 kHz
const voice = () => Float32Array.from({ length: BLOCK }, (_, i) => 0.2 * Math.sin(i / 3));
const silence = () => new Float32Array(BLOCK);
const hiss = () => Float32Array.from({ length: BLOCK }, (_, i) => 0.004 * Math.sin(i * 1.7));

/** Pushes `count` blocks made by `make` and collects everything handed out. */
function feed(segmenter: SpeechSegmenter, count: number, make: () => Float32Array): Utterance[] {
  const out: Utterance[] = [];
  for (let i = 0; i < count; i++) out.push(...segmenter.push(make()));
  return out;
}

describe('SpeechSegmenter', () => {
  it('hands out nothing for silence or a quiet room', () => {
    const s = new SpeechSegmenter();
    expect(feed(s, 100, silence)).toEqual([]);
    expect(feed(s, 100, hiss)).toEqual([]);
  });

  it('ignores a click shorter than the start threshold', () => {
    const s = new SpeechSegmenter();
    expect(feed(s, 1, voice)).toEqual([]);
    expect(feed(s, 20, silence)).toEqual([]);
  });

  it('gives one final utterance after a pause, with a little context around the words', () => {
    const s = new SpeechSegmenter();
    feed(s, 5, silence);
    const spoken = feed(s, 10, voice); // 1 s of speech
    expect(spoken.filter((u) => u.final)).toEqual([]);
    const ended = feed(s, 10, silence);
    const finals = ended.filter((u) => u.final);
    expect(finals).toHaveLength(1);
    const seconds = (finals[0]?.audio.length ?? 0) / 16_000;
    // 1 s of speech + preroll (≤0.4 s) + the kept tail (0.2 s)
    expect(seconds).toBeGreaterThan(1.1);
    expect(seconds).toBeLessThan(1.8);
  });

  it('emits interim decodes while the person keeps talking', () => {
    const s = new SpeechSegmenter();
    const out = feed(s, 40, voice); // 4 s
    const interim = out.filter((u) => !u.final);
    expect(interim.length).toBe(3); // every 1.2 s
    expect(interim[1]?.audio.length ?? 0).toBeGreaterThan(interim[0]?.audio.length ?? 0);
  });

  it('does not decode an utterance with too little speech', () => {
    const s = new SpeechSegmenter({ ...DEFAULT_SEGMENTER, startMs: 100, minSpeechMs: 400 });
    const out = [...feed(s, 2, voice), ...feed(s, 15, silence)];
    expect(out).toEqual([]);
  });

  it('splits an endless monologue at the maximum length and keeps going', () => {
    const s = new SpeechSegmenter();
    const out = feed(s, 300, voice); // 30 s
    const finals = out.filter((u) => u.final);
    expect(finals.length).toBeGreaterThanOrEqual(2);
    for (const u of finals) expect(u.audio.length / 16_000).toBeLessThanOrEqual(12.5);
  });

  it('starts a new utterance after the pause', () => {
    const s = new SpeechSegmenter();
    const first = [...feed(s, 10, voice), ...feed(s, 10, silence)].filter((u) => u.final);
    const second = [...feed(s, 10, voice), ...feed(s, 10, silence)].filter((u) => u.final);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  it('adapts to a noisy room: steady noise is not speech', () => {
    const s = new SpeechSegmenter();
    const loudHiss = () => Float32Array.from({ length: BLOCK }, (_, i) => 0.02 * Math.sin(i * 1.3));
    // The first seconds teach it the floor (it may fire early on); afterwards nothing.
    feed(s, 100, loudHiss);
    expect(feed(s, 50, loudHiss).filter((u) => u.final)).toEqual([]);
  });
});
