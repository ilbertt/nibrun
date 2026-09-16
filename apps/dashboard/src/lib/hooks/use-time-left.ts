import { useEffect, useState } from 'react';
import { describeTimeLeft } from '#lib/time-left.ts';

const MS_PER_MINUTE = 60_000;

/**
 * The countdown to a moment, in words, kept true to the clock at the grain the words change:
 * once a minute, since nothing under one is said as a number.
 */
export function useTimeLeft(until: string): string {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MS_PER_MINUTE);
    return () => clearInterval(timer);
  }, []);

  return describeTimeLeft({ until, now });
}
