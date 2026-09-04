import { expect, test } from 'bun:test';
import { offeredBinary } from '#lib/handoff-store.ts';

const MS_PER_HOUR = 3_600_000;
const JUST_INSIDE_HOURS = 11;
const JUST_PAST_HOURS = 13;
const NEXT_WEEK_HOURS = 168;

const BINARY = new File([], 'my-server');

function droppedHoursAgo(hours: number): unknown {
  return { binary: BINARY, storedAt: Date.now() - hours * MS_PER_HOUR };
}

test('a drop is offered while it is still the one this visit would have made', () => {
  expect(offeredBinary(droppedHoursAgo(0))).toBe(BINARY);
  expect(offeredBinary(droppedHoursAgo(JUST_INSIDE_HOURS))).toBe(BINARY);
});

test('a drop nobody came back for is not offered to whoever arrives next', () => {
  expect(offeredBinary(droppedHoursAgo(JUST_PAST_HOURS))).toBeUndefined();
  expect(offeredBinary(droppedHoursAgo(NEXT_WEEK_HOURS))).toBeUndefined();
});

// The bare `File` a release before this one wrote. Undatable, so unofferable — the alternative is
// offering it forever, which is the whole reason there is a date beside it now.
test('a record written the way a past release wrote it is not offered either', () => {
  expect(offeredBinary(BINARY)).toBeUndefined();
  expect(offeredBinary({ binary: BINARY })).toBeUndefined();
  expect(offeredBinary(undefined)).toBeUndefined();
});
