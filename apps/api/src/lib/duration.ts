import { LOG_TIMERANGE_PATTERN } from '@repo/protocol';

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

export const MS_PER_DAY = MS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY;

const UNIT_MS = {
  s: MS_PER_SECOND,
  m: MS_PER_SECOND * SECONDS_PER_MINUTE,
  h: MS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR,
} as const;

type Unit = keyof typeof UNIT_MS;

const DURATION = new RegExp(LOG_TIMERANGE_PATTERN);
const UNIT_LENGTH = 1;

/**
 * A duration as it is written on a command line, as the number of milliseconds it stands for.
 *
 * The pattern is checked again here rather than assumed: the schema that admits one of these is
 * the edge's, and this is the only thing that reads the string apart into a unit and a count.
 */
export function durationToMs(value: string): number {
  if (!DURATION.test(value)) {
    throw new Error(`Not a duration: ${value}`);
  }
  const unit = value.slice(-UNIT_LENGTH) as Unit;
  return Number(value.slice(0, -UNIT_LENGTH)) * UNIT_MS[unit];
}
