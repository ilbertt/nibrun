import { Button } from '@repo/ui/components/button';
import { Skeleton } from '@repo/ui/components/skeleton';
import { RefreshCwIcon } from 'lucide-react';
import { CronSchedules } from '#components/crons/cron-schedules.tsx';
import { FailureEmpty } from '#components/failure-empty.tsx';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useCronListing } from '#lib/hooks/use-cron-listing.ts';

export function CronListing() {
  const view = useCronListing(useAppId());

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-medium">Cron jobs</h2>
        <Button
          aria-label="Refresh cron jobs"
          disabled={view.isRefreshing}
          onClick={view.refresh}
          size="icon-sm"
          variant="outline"
        >
          <RefreshCwIcon className={view.isRefreshing ? 'animate-spin' : undefined} />
        </Button>
      </div>
      {view.reason !== undefined && (
        <FailureEmpty title="Could not read cron jobs" reason={view.reason} />
      )}
      {view.reason === undefined && view.listing === undefined && (
        <Skeleton className="h-48 w-full rounded-2xl" />
      )}
      {view.listing !== undefined && <CronSchedules listing={view.listing} />}
    </div>
  );
}
