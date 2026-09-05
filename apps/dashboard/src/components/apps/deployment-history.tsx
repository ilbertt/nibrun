import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@repo/ui/components/empty';
import { Skeleton } from '@repo/ui/components/skeleton';
import { PackageIcon } from 'lucide-react';
import { DeploymentsTable } from '#components/apps/deployments-table.tsx';
import { FailedDeploymentNotice } from '#components/apps/failed-deployment-notice.tsx';
import { FailureEmpty } from '#components/failure-empty.tsx';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useDeployments } from '#lib/hooks/use-deployments.ts';

export function DeploymentHistory() {
  const appId = useAppId();
  const deployments = useDeployments(appId);

  if (deployments.isPending) {
    return <Skeleton className="h-48 w-full rounded-2xl" />;
  }
  if (deployments.isError) {
    return (
      <FailureEmpty title="Could not read the deployments" reason={deployments.error.message} />
    );
  }
  const newest = deployments.data[0];
  if (newest === undefined) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PackageIcon />
          </EmptyMedia>
          <EmptyTitle>This app has never been deployed</EmptyTitle>
          <EmptyDescription>
            <code className="font-mono">nib run</code> is what releases a binary into it.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <CardHeader className="px-4 pt-4">
        <CardTitle>Deployments</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {newest.state === 'failed' && (
          <div className="px-4 pb-4">
            <FailedDeploymentNotice deployment={newest} />
          </div>
        )}
        <DeploymentsTable deployments={deployments.data} />
      </CardContent>
    </Card>
  );
}
