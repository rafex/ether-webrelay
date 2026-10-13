import type { TimeSource } from '../../ports/time';

/** Monotonic high-resolution time; immune to wall-clock adjustments. */
export const performanceTimeSource: TimeSource = {
  nowMs: () => performance.now(),
};
