import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallController, CallSnapshot } from '../../src/application/call-controller';
import {
  CaptionService,
  MIN_CAPTION_INTERVAL_MS,
  RETRY_AFTER_FAILURE_MS,
} from '../../src/application/caption-service';
import type { MediaTrackLike } from '../../src/ports/media';
import type { TranscriberPort } from '../../src/ports/transcriber';

interface FakeMic {
  readyState: 'live' | 'ended';
}

class FakeCall {
  state: CallSnapshot['state'] = 'connected';
  captions = true;
  muted = false;
  microphone: FakeMic | undefined = { readyState: 'live' };
  readonly sent: string[] = [];
  private readonly listeners = new Set<() => void>();

  get snapshot(): CallSnapshot {
    return {
      state: this.state,
      captions: this.captions,
      self: { muted: this.muted, cameraOff: false, screenSharing: false },
      local: this.microphone ? { microphone: this.microphone as MediaTrackLike } : {},
    } as unknown as CallSnapshot;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  sendCaption(text: string): void {
    this.sent.push(text);
  }
  change(): void {
    for (const l of this.listeners) l();
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
}

class FakeTranscriber implements TranscriberPort {
  available = true;
  status = '';
  readonly started: MediaTrackLike[] = [];
  stops = 0;
  failWith: Error | undefined;
  /** When set, start() waits for it (an engine that is still loading). */
  gate: Promise<void> | undefined;
  say: ((text: string) => void) | undefined;

  async start(track: MediaTrackLike, onLine: (text: string) => void) {
    this.started.push(track);
    if (this.gate) await this.gate;
    if (this.failWith) throw this.failWith;
    this.say = onLine;
    return {
      stop: () => {
        this.stops++;
      },
    };
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('CaptionService', () => {
  let call: FakeCall;
  let engine: FakeTranscriber;
  let optedIn: boolean;
  let clock: number;

  const create = () =>
    new CaptionService(
      { call: call as unknown as CallController, transcriber: engine, enabled: () => optedIn },
      () => clock,
    );

  beforeEach(() => {
    vi.useFakeTimers();
    call = new FakeCall();
    engine = new FakeTranscriber();
    optedIn = true;
    clock = 1_000;
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    ['the guest did not opt in', () => (optedIn = false)],
    ['the host did not turn captions on', () => (call.captions = false)],
    ['the guest is muted', () => (call.muted = true)],
    ['there is no microphone', () => (call.microphone = undefined)],
    ['the microphone ended', () => (call.microphone = { readyState: 'ended' })],
    ['the call is not connected yet', () => (call.state = 'joining')],
    ['there is no engine', () => (engine.available = false)],
  ])('stays off when %s', async (_label, arrange) => {
    arrange();
    const service = create();
    await flush();
    expect(engine.started).toEqual([]);
    expect(service.running).toBe(false);
  });

  it('listens to the microphone and sends what it hears to the call', async () => {
    const service = create();
    await flush();
    expect(engine.started).toHaveLength(1);
    expect(service.running).toBe(true);
    engine.say?.('hola a todos');
    expect(call.sent).toEqual(['hola a todos']);
    service.dispose();
  });

  it('stops, clearing the line, when the guest mutes, and listens again when unmuted', async () => {
    const service = create();
    await flush();
    engine.say?.('estoy hablando');
    call.muted = true;
    call.change();
    expect(engine.stops).toBe(1);
    expect(call.sent.at(-1)).toBe(''); // the caption goes away with the voice
    call.muted = false;
    call.change();
    await flush();
    expect(engine.started).toHaveLength(2);
    service.dispose();
  });

  it('follows the host turning captions off and on', async () => {
    const service = create();
    await flush();
    call.captions = false;
    call.change();
    expect(service.running).toBe(false);
    call.captions = true;
    call.change();
    await flush();
    expect(service.running).toBe(true);
    service.dispose();
  });

  it('listens to the new microphone when it is replaced', async () => {
    const service = create();
    await flush();
    const first = engine.started[0];
    call.microphone = { readyState: 'live' };
    call.change();
    await flush();
    expect(engine.started).toHaveLength(2);
    expect(engine.started[1]).not.toBe(first);
    expect(engine.stops).toBe(1);
    service.dispose();
  });

  it('does not restart for snapshots that change nothing', async () => {
    const service = create();
    await flush();
    for (let i = 0; i < 5; i++) call.change();
    await flush();
    expect(engine.started).toHaveLength(1);
    service.dispose();
  });

  describe('rate', () => {
    it('keeps only the newest line while the interval has not passed', async () => {
      const service = create();
      await flush();
      engine.say?.('uno');
      clock += 50;
      engine.say?.('uno dos');
      clock += 50;
      engine.say?.('uno dos tres');
      expect(call.sent).toEqual(['uno']);
      clock += MIN_CAPTION_INTERVAL_MS;
      vi.advanceTimersByTime(MIN_CAPTION_INTERVAL_MS);
      expect(call.sent).toEqual(['uno', 'uno dos tres']);
      service.dispose();
    });

    it('does not repeat a line, and a clear is never held back', async () => {
      const service = create();
      await flush();
      engine.say?.('hola');
      clock += 1000;
      engine.say?.('hola');
      expect(call.sent).toEqual(['hola']);
      clock += 10;
      engine.say?.('');
      expect(call.sent).toEqual(['hola', '']);
      service.dispose();
    });
  });

  describe('when the engine cannot start', () => {
    it('explains it, leaves the call alone and does not retry on every snapshot', async () => {
      engine.failWith = new Error('modelo no descargado');
      const service = create();
      await flush();
      expect(service.status).toContain('modelo no descargado');
      expect(service.running).toBe(false);
      for (let i = 0; i < 10; i++) call.change();
      await flush();
      expect(engine.started).toHaveLength(1);

      clock += RETRY_AFTER_FAILURE_MS + 1;
      engine.failWith = undefined;
      call.change();
      await flush();
      expect(engine.started).toHaveLength(2);
      expect(service.running).toBe(true);
      expect(service.status).toBe('');
      service.dispose();
    });

    it('tries again at once when the guest changes something', async () => {
      engine.failWith = new Error('x');
      const service = create();
      await flush();
      call.muted = true; // conditions stop holding...
      call.change();
      call.muted = false; // ...and hold again
      engine.failWith = undefined;
      call.change();
      await flush();
      expect(service.running).toBe(true);
      service.dispose();
    });
  });

  it('drops the engine that finished loading after the conditions changed', async () => {
    let open: () => void = () => undefined;
    engine.gate = new Promise((resolve) => {
      open = resolve;
    });
    const service = create();
    await flush();
    call.muted = true; // while the engine was still loading
    call.change();
    open();
    await flush();
    expect(engine.stops).toBe(1);
    expect(service.running).toBe(false);
    service.dispose();
  });

  it('stops listening and unsubscribes when disposed', async () => {
    const service = create();
    await flush();
    service.dispose();
    expect(engine.stops).toBe(1);
    expect(call.listenerCount).toBe(0);
    call.change();
    await flush();
    expect(engine.started).toHaveLength(1);
  });
});
