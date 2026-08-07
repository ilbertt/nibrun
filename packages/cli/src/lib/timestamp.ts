const DAY_AND_MINUTE_END = 16;

/**
 * The date as well as the time, unlike a log line: what a log holds is what just happened, and
 * what an app or a file holds may have been written months ago. UTC, as logs are.
 */
export function dayAndMinute(instant: string): string {
  return new Date(instant).toISOString().slice(0, DAY_AND_MINUTE_END).replace('T', ' ');
}
