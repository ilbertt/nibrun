import { describe, expect, test } from 'bun:test';
import { describeTimeLeft } from '#lib/time-left.ts';

const NOW = Date.parse('2026-09-16T12:00:00.000Z');
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const HALF_A_MINUTE_MS = 30_000;
const LAST_MINUTE_OF_THE_HOUR = 59;
const TWO = 2;

function inMs(ms: number): string {
  return new Date(NOW + ms).toISOString();
}

describe('a deadline is said in the words a countdown wants', () => {
  test('minutes are rounded up, so a deadline is never said as sooner than it is', () => {
    expect(describeTimeLeft({ until: inMs(HALF_A_MINUTE_MS), now: NOW })).toBe('1 minute');
    expect(describeTimeLeft({ until: inMs(MS_PER_MINUTE + 1), now: NOW })).toBe('2 minutes');
    expect(
      describeTimeLeft({ until: inMs(LAST_MINUTE_OF_THE_HOUR * MS_PER_MINUTE), now: NOW }),
    ).toBe('59 minutes');
  });

  test('an hour and up is said in hours', () => {
    expect(describeTimeLeft({ until: inMs(MS_PER_HOUR), now: NOW })).toBe('1 hour');
    expect(describeTimeLeft({ until: inMs(MS_PER_HOUR + MS_PER_MINUTE), now: NOW })).toBe('1 hour');
    expect(describeTimeLeft({ until: inMs(TWO * MS_PER_HOUR), now: NOW })).toBe('2 hours');
  });

  test('a deadline that has passed is moments, for the report that acts on it', () => {
    expect(describeTimeLeft({ until: inMs(0), now: NOW })).toBe('moments');
    expect(describeTimeLeft({ until: inMs(-MS_PER_MINUTE), now: NOW })).toBe('moments');
  });
});
