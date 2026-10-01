import { CRON_TIME_ZONE } from '@repo/protocol';
import { useState } from 'react';
import { dayAndSecondInTimeZone } from '#lib/format-timestamp.ts';

type CronTimeZoneView = {
  label: string;
  isLocal: boolean;
  toggle: () => void;
  formatTimestamp: (instant: string) => string;
};

export function useCronTimeZone(): CronTimeZoneView {
  const [isLocal, setIsLocal] = useState(false);

  function toggle() {
    setIsLocal((current) => !current);
  }

  function formatTimestamp(instant: string): string {
    return dayAndSecondInTimeZone({
      instant,
      timeZone: isLocal ? undefined : CRON_TIME_ZONE,
    });
  }

  return { label: isLocal ? 'Local' : CRON_TIME_ZONE, isLocal, toggle, formatTimestamp };
}
