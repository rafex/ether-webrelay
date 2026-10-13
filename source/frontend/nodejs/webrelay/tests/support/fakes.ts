import { decodeFrame, type Frame, type TrackConfig } from '../../src/domain/protocol';
import type {
  EncodedChunk,
  MediaPipelinePort,
  MediaPipelineSink,
} from '../../src/ports/media-pipeline';
import type { Timer, TimerHandle, TimeSource } from '../../src/ports/time';
import type {
  CloseInfo,
  TransportConnection,
  TransportHandlers,
  TransportPort,
} from '../../src/ports/transport';

/** Deterministic clock + timer: time only moves when `advance()` is called. */
export class ManualClock implements TimeSource, Timer {
  private now = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; fn: () => void; period?: number }>();

  nowMs(): number {
    return this.now;
  }

  setTimeout(fn: () => void, delayMs: number): TimerHandle {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + delayMs, fn });
    return id;
  }

  clearTimeout(handle: TimerHandle): void {
    this.tasks.delete(handle as number);
  }

  setInterval(fn: () => void, periodMs: number): TimerHandle {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + periodMs, fn, period: periodMs });
    return id;
  }

  clearInterval(handle: TimerHandle): void {
    this.tasks.delete(handle as number);
  }

  /** Advances time, firing due tasks in chronological order. */
  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.tasks.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, task] = due;
      this.now = task.at;
      if (task.period) task.at += task.period;
      else this.tasks.delete(id);
      task.fn();
      await flushMicrotasks();
    }
    this.now = target;
    await flushMicrotasks();
  }

  get pendingTasks(): number {
    return this.tasks.size;
  }
}

export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

export class FakeConnection implements TransportConnection {
  readonly sent: Frame[] = [];
  bufferedAmount = 0;
  closed: { code?: number; reason?: string } | undefined;

  constructor(readonly handlers: TransportHandlers) {}

  send(data: ArrayBuffer): void {
    if (this.closed) throw new Error('send on closed connection');
    this.sent.push(decodeFrame(data));
  }

  close(code?: number, reason?: string): void {
    this.closed = { ...(code !== undefined ? { code } : {}), ...(reason ? { reason } : {}) };
  }

  /** Simulates a message from the bridge. */
  receive(message: object): void {
    this.handlers.onText(JSON.stringify(message));
  }

  /** Simulates the bridge (or network) dropping the connection. */
  drop(info: CloseInfo = { code: 1006, reason: '', wasClean: false }): void {
    this.closed = { code: info.code };
    this.handlers.onClose(info);
  }
}

export class FakeTransport implements TransportPort {
  readonly connections: FakeConnection[] = [];
  readonly urls: string[] = [];
  /** Number of upcoming connect() calls that should fail. */
  failNext = 0;

  async connect(url: string, handlers: TransportHandlers): Promise<TransportConnection> {
    this.urls.push(url);
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('connection refused');
    }
    const connection = new FakeConnection(handlers);
    this.connections.push(connection);
    return connection;
  }

  get last(): FakeConnection {
    const connection = this.connections.at(-1);
    if (!connection) throw new Error('no connection yet');
    return connection;
  }
}

export class FakePipeline implements MediaPipelinePort {
  sink: MediaPipelineSink | undefined;
  keyframeRequests = 0;
  started = false;
  stopped = false;
  startError: Error | undefined;

  async start(sink: MediaPipelineSink): Promise<void> {
    if (this.startError) throw this.startError;
    this.sink = sink;
    this.started = true;
  }

  requestKeyframe(): void {
    this.keyframeRequests++;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  emitConfig(config: TrackConfig): void {
    this.requireSink().onConfig(config);
  }

  emitChunk(chunk: Partial<EncodedChunk> & Pick<EncodedChunk, 'track'>): void {
    this.requireSink().onChunk({
      keyframe: false,
      timestampUs: 0,
      durationUs: 33_333,
      data: new Uint8Array([1, 2, 3]),
      ...chunk,
    });
  }

  private requireSink(): MediaPipelineSink {
    if (!this.sink) throw new Error('pipeline not started');
    return this.sink;
  }
}

export const VIDEO_CONFIG: TrackConfig = {
  track: 'video',
  codec: 'avc1.64001F',
  family: 'h264',
  width: 1280,
  height: 720,
  framerate: 30,
  bitrate: 2_500_000,
  description: 'AQ==',
};

export const AUDIO_CONFIG: TrackConfig = {
  track: 'audio',
  codec: 'mp4a.40.2',
  family: 'aac',
  sampleRate: 48_000,
  channels: 2,
  bitrate: 128_000,
  description: 'EZA=',
};
