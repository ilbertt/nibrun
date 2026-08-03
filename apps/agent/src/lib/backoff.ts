const FIRST_ATTEMPT = 0;

export type BackoffPolicy = {
  initialBackoffMs: number;
  maxBackoffMs: number;
  backoffFactor: number;
};

/**
 * Delay before attempt `attempt`, counted from zero — so the first attempt never waits.
 *
 * The shape is deliberately the same as the guest's restart policy and reads its numbers from
 * the same object: the agent retrying a boot and the guest retrying a process are the same
 * question asked one layer apart, and two sets of tuning constants for it would drift.
 */
export function backoffDelayMs({
  attempt,
  policy,
}: {
  attempt: number;
  policy: BackoffPolicy;
}): number {
  if (attempt <= FIRST_ATTEMPT) {
    return 0;
  }
  const grown = policy.initialBackoffMs * policy.backoffFactor ** (attempt - 1);
  return Math.min(Math.round(grown), policy.maxBackoffMs);
}

export type AttemptWindow = {
  attempts: number;
  lastAttemptAtMs?: number;
};

/**
 * A component that stayed up longer than `resetAfterMs` is treated as healthy and starts its
 * budget over, so something that fails once a month never eventually exhausts a lifetime one.
 */
export function nextAttemptWindow({
  window,
  nowMs,
  resetAfterMs,
}: {
  window: AttemptWindow;
  nowMs: number;
  resetAfterMs: number;
}): AttemptWindow {
  const elapsed = window.lastAttemptAtMs === undefined ? 0 : nowMs - window.lastAttemptAtMs;
  const attempts = elapsed >= resetAfterMs ? 1 : window.attempts + 1;
  return { attempts, lastAttemptAtMs: nowMs };
}

export function isReadyToRetry({
  window,
  nowMs,
  policy,
}: {
  window: AttemptWindow;
  nowMs: number;
  policy: BackoffPolicy;
}): boolean {
  if (window.lastAttemptAtMs === undefined) {
    return true;
  }
  return nowMs - window.lastAttemptAtMs >= backoffDelayMs({ attempt: window.attempts, policy });
}
