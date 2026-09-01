import { describe, expect, test } from 'bun:test';
import { MAX_IDLE_TIMEOUT_MS, MIN_IDLE_TIMEOUT_MS } from '@repo/protocol';
import { activationSummary, idleTimeoutLabel } from '#activation.ts';

const A_QUARTER_HOUR_MS = 900_000;
const NINETY_MINUTES_MS = 5_400_000;

describe('a wait is written the way somebody would say it', () => {
  test('a whole number of hours is hours', () => {
    expect(idleTimeoutLabel(MAX_IDLE_TIMEOUT_MS)).toBe('24h');
  });

  // Rounding to `2h` would name a wait an hour and a half long as one twice that, which is the
  // one thing a label on a number must not do.
  test('anything else stays in minutes rather than rounding to the nearest hour', () => {
    expect(idleTimeoutLabel(NINETY_MINUTES_MS)).toBe('90m');
    expect(idleTimeoutLabel(MIN_IDLE_TIMEOUT_MS)).toBe('1m');
  });
});

describe('how an app comes up is one line', () => {
  test('an app that sleeps says how long it waits first', () => {
    expect(activationSummary({ activation: 'on-request', idleTimeoutMs: A_QUARTER_HOUR_MS })).toBe(
      'On request, stopped after 15m of quiet',
    );
  });

  /**
   * Every app carries a timeout whatever its activation, so the one on an `always` app is a value
   * nothing reads. Naming it would read as a wait the app is under and ignoring.
   */
  test('an app that never sleeps names no wait, though it has one', () => {
    expect(activationSummary({ activation: 'always', idleTimeoutMs: A_QUARTER_HOUR_MS })).toBe(
      'Always on',
    );
  });
});
