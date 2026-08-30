import type { TenantLogRecord } from '@repo/protocol';
import { hasLiveOutput } from '@repo/protocol';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppStatus } from '#lib/hooks/use-app-status.ts';
import { useLogTimerange } from '#lib/hooks/use-log-timerange.ts';
import { useNewestDeployment } from '#lib/hooks/use-newest-deployment.ts';
import { deploymentLogsQueryOptions } from '#queries/logs.ts';

/**
 * `not-running` is a stream that is open and will stay silent: the records under it are the app's
 * history and nothing is left to add to them. Saying that rather than nothing, because a page with
 * no word for it is one where the owner is left waiting on output that is never coming.
 */
export type DeploymentLogsView = {
  status: 'connecting' | 'following' | 'not-running' | 'failed';
  records: readonly TenantLogRecord[];
  deploymentId: string | undefined;
  reason: string | undefined;
};

export function useDeploymentLogs(appId: string): DeploymentLogsView {
  const app = useApp(appId);
  const status = useAppStatus(app.data).status;
  const newest = useNewestDeployment(appId);
  const deploymentId = newest.data?.id;
  const timerange = useLogTimerange();
  const logs = useQuery(deploymentLogsQueryOptions({ appId, deploymentId, timerange }));
  const records = logs.data ?? [];

  if (newest.isError) {
    return { status: 'failed', records, deploymentId: undefined, reason: newest.error.message };
  }
  if (logs.isError) {
    return { status: 'failed', records, deploymentId, reason: logs.error.message };
  }
  // An app still being read is one nothing is known about yet, which is what connecting says.
  if (deploymentId === undefined || status === undefined) {
    return { status: 'connecting', records, deploymentId, reason: undefined };
  }
  return {
    status: hasLiveOutput(status) ? 'following' : 'not-running',
    records,
    deploymentId,
    reason: undefined,
  };
}
