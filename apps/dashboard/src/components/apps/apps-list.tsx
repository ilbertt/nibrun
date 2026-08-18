import { Card } from '@repo/ui/components/card';
import { Skeleton } from '@repo/ui/components/skeleton';
import { AppsTable } from '#components/apps/apps-table.tsx';
import { NoAppsEmpty } from '#components/apps/no-apps-empty.tsx';
import { FailureEmpty } from '#components/failure-empty.tsx';
import { useApps } from '#lib/hooks/use-apps.ts';

export function AppsList() {
  const apps = useApps();

  if (apps.isPending) {
    return <Skeleton className="h-48 w-full rounded-2xl" />;
  }
  if (apps.isError) {
    return <FailureEmpty title="Could not read your apps" reason={apps.error.message} />;
  }
  if (apps.data.length === 0) {
    return <NoAppsEmpty />;
  }

  return (
    <Card className="overflow-hidden p-0">
      <AppsTable apps={apps.data} />
    </Card>
  );
}
