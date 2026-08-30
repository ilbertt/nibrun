import { describe, expect, test } from 'bun:test';
import { describeProgress } from '#lib/upload-progress.ts';

const TOTAL = 200_000_000;
const TENTH = 20_000_000;
const HALF = 100_000_000;
const A_MINUTE = 60_000;
const TEN_SECONDS = 10_000;

function at({ sentBytes, elapsedMs }: { sentBytes: number; elapsedMs: number }): string {
  return describeProgress({ progress: { sentBytes, totalBytes: TOTAL }, elapsedMs });
}

describe('what is left is guessed from what has gone', () => {
  test('a tenth in after a minute has nine more to go', () => {
    expect(at({ sentBytes: TENTH, elapsedMs: A_MINUTE })).toBe('10%, about 9m left');
  });

  test('halfway is as long again', () => {
    expect(at({ sentBytes: HALF, elapsedMs: A_MINUTE })).toBe('50%, about 1m left');
  });

  test('under a minute is counted in seconds', () => {
    expect(at({ sentBytes: HALF, elapsedMs: TEN_SECONDS })).toBe('50%, about 10s left');
  });

  test('the last byte is none left rather than a negative guess', () => {
    expect(at({ sentBytes: TOTAL, elapsedMs: A_MINUTE })).toBe('100%, about 0s left');
  });
});

// Elapsed time this early is mostly the connection opening, and a guess drawn from it swings
// between wild numbers on consecutive redraws.
test('too little has gone to guess from, so nothing is guessed', () => {
  expect(at({ sentBytes: 1, elapsedMs: TEN_SECONDS })).toBe('0%');
});
