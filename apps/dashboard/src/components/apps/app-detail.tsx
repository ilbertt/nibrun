import { AppConfigCard } from '#components/apps/app-config-card.tsx';
import { AppOverviewCard } from '#components/apps/app-overview-card.tsx';
import { DeploymentHistory } from '#components/apps/deployment-history.tsx';
import { FailureEmpty } from '#components/failure-empty.tsx';
import { Skeleton } from '#components/ui/skeleton.tsx';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';

export function AppDetail() {
  const appId = useAppId();
  const app = useApp(appId);

  if (app.isPending) {
    return <Skeleton className="h-64 w-full rounded-2xl" />;
  }
  if (app.isError) {
    return <FailureEmpty title="Could not read that app" reason={app.error.message} />;
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="grid @3xl/main:grid-cols-2 grid-cols-1 gap-4 md:gap-6">
        <AppOverviewCard app={app.data} />
        <AppConfigCard app={app.data} />
      </div>
      <DeploymentHistory />
    </div>
  );
}
