const FIRST_ATTEMPT = 0;
const ONE_ATTEMPT = 1;

export type BackoffPolicy = {
  readonly initialBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly backoffFactor: number;
};

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
  const grown = policy.initialBackoffMs * policy.backoffFactor ** (attempt - ONE_ATTEMPT);
  return Math.min(Math.round(grown), policy.maxBackoffMs);
}

export type AttemptWindow = {
  readonly attempts: number;
  readonly lastAttemptAtMs?: number;
};

/** Staying up longer than `resetAfterMs` restarts the budget, so a monthly failure never exhausts it. */
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
  return {
    attempts: elapsed >= resetAfterMs ? ONE_ATTEMPT : window.attempts + ONE_ATTEMPT,
    lastAttemptAtMs: nowMs,
  };
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
