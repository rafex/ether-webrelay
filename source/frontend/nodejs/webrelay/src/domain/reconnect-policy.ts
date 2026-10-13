export interface ReconnectPolicyOptions {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly multiplier: number;
  /** 0..1 — fraction of the delay randomised to avoid thundering herds. */
  readonly jitterRatio: number;
  /** Attempts before giving up; `Infinity` retries forever. */
  readonly maxAttempts: number;
}

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicyOptions = {
  initialDelayMs: 500,
  maxDelayMs: 10_000,
  multiplier: 2,
  jitterRatio: 0.2,
  maxAttempts: 20,
};

/** Exponential backoff with bounded jitter. */
export class ReconnectPolicy {
  private attemptCount = 0;

  constructor(
    private readonly options: ReconnectPolicyOptions = DEFAULT_RECONNECT_POLICY,
    private readonly random: () => number = Math.random,
  ) {
    if (options.initialDelayMs < 0 || options.maxDelayMs < options.initialDelayMs) {
      throw new RangeError('invalid reconnect delays');
    }
    if (options.multiplier < 1) throw new RangeError('multiplier must be >= 1');
    if (options.jitterRatio < 0 || options.jitterRatio > 1) {
      throw new RangeError('jitterRatio must be within [0, 1]');
    }
  }

  get attempts(): number {
    return this.attemptCount;
  }

  /** Delay before the next attempt, or `null` when attempts are exhausted. */
  nextDelayMs(): number | null {
    if (this.attemptCount >= this.options.maxAttempts) return null;
    const base = Math.min(
      this.options.maxDelayMs,
      this.options.initialDelayMs * this.options.multiplier ** this.attemptCount,
    );
    this.attemptCount++;
    const jitter = base * this.options.jitterRatio * (this.random() * 2 - 1);
    return Math.max(0, Math.round(base + jitter));
  }

  /** Call after a successful (re)connection. */
  reset(): void {
    this.attemptCount = 0;
  }
}
