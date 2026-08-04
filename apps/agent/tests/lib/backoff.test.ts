import { describe, expect, test } from 'bun:test';
import { DEFAULT_RESTART_POLICY } from '@repo/protocol';
import { backoffDelayMs, isReadyToRetry, nextAttemptWindow } from '#lib/backoff.ts';

const policy = DEFAULT_RESTART_POLICY;
const TWO_GROWTHS = 2;
const THIRD_ATTEMPT = 3;
const FAR_PAST_THE_CAP = 100;
const RESET_AFTER_MS = 60_000;
const FLAT_BACKOFF = { initialBackoffMs: 250, maxBackoffMs: 1_000, backoffFactor: 1 };

describe('backoffDelayMs', () => {
  test('the first attempt does not wait', () => {
    expect(backoffDelayMs({ attempt: 0, policy })).toBe(0);
  });

  test('it grows by the factor', () => {
    expect(backoffDelayMs({ attempt: 1, policy })).toBe(policy.initialBackoffMs);
    expect(backoffDelayMs({ attempt: 2, policy })).toBe(
      policy.initialBackoffMs * policy.backoffFactor,
    );
    expect(backoffDelayMs({ attempt: 3, policy })).toBe(
      policy.initialBackoffMs * policy.backoffFactor ** TWO_GROWTHS,
    );
  });

  test('it is capped, so a long-broken app is retried at a fixed slow rate', () => {
    expect(backoffDelayMs({ attempt: FAR_PAST_THE_CAP, policy })).toBe(policy.maxBackoffMs);
  });

  test('a factor of one degenerates to a constant delay rather than to zero', () => {
    expect(backoffDelayMs({ attempt: THIRD_ATTEMPT, policy: FLAT_BACKOFF })).toBe(
      FLAT_BACKOFF.initialBackoffMs,
    );
  });
});

describe('nextAttemptWindow', () => {
  test('the first attempt counts as one', () => {
    expect(
      nextAttemptWindow({ window: { attempts: 0 }, nowMs: 0, resetAfterMs: RESET_AFTER_MS }),
    ).toEqual({
      attempts: 1,
      lastAttemptAtMs: 0,
    });
  });

  test('attempts accumulate inside the reset window', () => {
    const first = nextAttemptWindow({
      window: { attempts: 0 },
      nowMs: 0,
      resetAfterMs: RESET_AFTER_MS,
    });
    const second = nextAttemptWindow({ window: first, nowMs: 1_000, resetAfterMs: RESET_AFTER_MS });
    expect(second.attempts).toBe(2);
  });

  test('a long gap resets the budget, so a monthly failure never exhausts it', () => {
    const window = { attempts: policy.maxRestarts, lastAttemptAtMs: 0 };
    expect(
      nextAttemptWindow({
        window,
        nowMs: RESET_AFTER_MS * TWO_GROWTHS,
        resetAfterMs: RESET_AFTER_MS,
      }).attempts,
    ).toBe(1);
  });
});

describe('isReadyToRetry', () => {
  test('a fresh window retries immediately', () => {
    expect(isReadyToRetry({ window: { attempts: 0 }, nowMs: 0, policy })).toBe(true);
  });

  test('a retry inside the backoff is refused and allowed once it lapses', () => {
    const window = { attempts: THIRD_ATTEMPT, lastAttemptAtMs: 0 };
    const delay = backoffDelayMs({ attempt: THIRD_ATTEMPT, policy });
    expect(isReadyToRetry({ window, nowMs: delay - 1, policy })).toBe(false);
    expect(isReadyToRetry({ window, nowMs: delay, policy })).toBe(true);
  });
});
