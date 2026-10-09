import { describe, expect, test } from 'bun:test';
import { backoffDelayMs } from '#lib/backoff.ts';
import { RESTART_POLICY_FIXTURE } from '#tests/support/fixtures.ts';

const policy = RESTART_POLICY_FIXTURE;
const TWO_GROWTHS = 2;
const THIRD_ATTEMPT = 3;
const FAR_PAST_THE_CAP = 100;
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
