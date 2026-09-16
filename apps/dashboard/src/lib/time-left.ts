const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

/**
 * How long until a moment, in the words a countdown wants: minutes while there are some, hours
 * once there are at least that many. Rounded up, so a deadline is never said as sooner than it
 * is — and "moments" once it has passed, for the seconds before the next host report acts on it.
 */
export function describeTimeLeft({ until, now }: { until: string; now: number }): string {
  const minutes = Math.ceil((Date.parse(until) - now) / MS_PER_MINUTE);
  if (minutes < 1) {
    return 'moments';
  }
  if (minutes < MINUTES_PER_HOUR) {
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}
