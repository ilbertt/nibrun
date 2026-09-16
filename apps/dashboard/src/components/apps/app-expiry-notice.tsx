import { HourglassIcon } from 'lucide-react';
import { KeepAppsButton } from '#components/login/keep-apps-button.tsx';
import { useTimeLeft } from '#lib/hooks/use-time-left.ts';

/**
 * What a stranger is told on their app's page: the clock, and the one way to stop it. Shown for
 * any app with a deadline rather than for any stranger, because the deadline is the app's — an
 * app claimed while this is open loses it, and the notice goes with the next read.
 */
export function AppExpiryNotice({ expiresAt }: { expiresAt: string }) {
  const timeLeft = useTimeLeft(expiresAt);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">
      <HourglassIcon className="size-4 shrink-0" />
      <span className="flex-1">
        This app is deleted in <span className="font-medium">{timeLeft}</span> — it was made without
        an account. Sign in and it is yours to keep.
      </span>
      <KeepAppsButton size="sm" />
    </div>
  );
}
