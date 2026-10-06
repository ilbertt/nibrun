import { useState } from 'react';
import { dayAndSecondInTimeZone } from '#lib/format-timestamp.ts';

type CronTimeZoneView = {
  label: string;
  isLocal: boolean;
  toggle: () => void;
  formatTimestamp: (instant: string) => string;
};

export function useCronTimeZone(timeZone: string): CronTimeZoneView {
  const [isLocal, setIsLocal] = useState(false);

  function toggle() {
    setIsLocal((current) => !current);
  }

  function formatTimestamp(instant: string): string {
    return dayAndSecondInTimeZone({
      instant,
      timeZone: isLocal ? undefined : timeZone,
    });
  }

  return { label: isLocal ? 'Local' : timeZone, isLocal, toggle, formatTimestamp };
}
