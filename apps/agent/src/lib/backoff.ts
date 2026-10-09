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
