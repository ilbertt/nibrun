import { useEffect, useState } from 'react';

/**
 * Whether at least `ms` have passed since `since`, kept true to the clock: a component asking
 * before the moment is rendered again the instant it arrives, and never polled. The clock is read
 * once and again only when the moment comes, so a render for any other reason re-arms nothing.
 */
export function useElapsed({ since, ms }: { since: string; ms: number }): boolean {
  const due = Date.parse(since) + ms;
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (due <= now) {
      return;
    }
    const timer = setTimeout(() => setNow(Date.now()), due - now);
    return () => clearTimeout(timer);
  }, [due, now]);

  return due <= now;
}
