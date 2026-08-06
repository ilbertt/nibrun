import { describe, expect, test } from 'bun:test';
import { durationToMs } from '#lib/duration.ts';

const THIRTY_SECONDS_MS = 30_000;
const FIVE_MINUTES_MS = 300_000;
const TWO_HOURS_MS = 7_200_000;

describe('a duration written on a command line is a number of milliseconds', () => {
  test('each unit stands for what it says', () => {
    expect(durationToMs('30s')).toBe(THIRTY_SECONDS_MS);
    expect(durationToMs('5m')).toBe(FIVE_MINUTES_MS);
    expect(durationToMs('2h')).toBe(TWO_HOURS_MS);
  });

  // The edge schema admits the same pattern, so this is what a caller that skipped it meets.
  test('something that is not a duration is refused rather than read as a number', () => {
    expect(() => durationToMs('forever')).toThrow('Not a duration');
    expect(() => durationToMs('0m')).toThrow('Not a duration');
    expect(() => durationToMs('5d')).toThrow('Not a duration');
  });
});
