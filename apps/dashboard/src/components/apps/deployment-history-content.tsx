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
import { useArtifacts } from '#lib/hooks/use-artifacts.ts';
import { useDeployments } from '#lib/hooks/use-deployments.ts';

export function DeploymentHistoryContent() {
  const appId = useAppId();
  const deployments = useDeployments(appId);
  const artifacts = useArtifacts(appId);

  if (deployments.isPending || artifacts.isPending) {
    return <Skeleton className="mx-4 h-48 rounded-2xl" />;
  }
  if (deployments.isError) {
    return (
      <FailureEmpty title="Could not read the deployments" reason={deployments.error.message} />
    );
  }
  if (artifacts.isError) {
    return <FailureEmpty title="Could not read the binaries" reason={artifacts.error.message} />;
  }
  const newest = deployments.data[0];
  if (newest === undefined) {
    return (
      <Empty>
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
    <>
      {newest.state === 'failed' && (
        <div className="px-4 pb-4">
          <FailedDeploymentNotice deployment={newest} />
        </div>
      )}
      <DeploymentsTable deployments={deployments.data} artifacts={artifacts.data} />
    </>
  );
}
