import { PackageIcon } from 'lucide-react';
import { DeploymentsTable } from '#components/apps/deployments-table.tsx';
import { FailureEmpty } from '#components/failure-empty.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '#components/ui/card.tsx';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#components/ui/empty.tsx';
import { Skeleton } from '#components/ui/skeleton.tsx';
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
  if (deployments.data.length === 0) {
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
        <DeploymentsTable deployments={deployments.data} />
      </CardContent>
    </Card>
  );
}
