export type { TimeSource } from '../domain/media-clock';

export type TimerHandle = unknown;

/** Driven port over `setTimeout`/`setInterval`, injectable for deterministic tests. */
export interface Timer {
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(callback: () => void, periodMs: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}

export const systemTimer: Timer = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, periodMs) => globalThis.setInterval(callback, periodMs),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};
