import type { TenantLogRecord } from '@repo/protocol';
import { useQuery } from '@tanstack/react-query';
import { useLatestDeployment } from '#lib/hooks/use-latest-deployment.ts';
import { useLogTimerange } from '#lib/hooks/use-log-timerange.ts';
import { deploymentLogsQueryOptions } from '#queries/logs.ts';

export type DeploymentLogsView = {
  status: 'connecting' | 'following' | 'failed';
  records: readonly TenantLogRecord[];
  deploymentId: string | undefined;
  reason: string | undefined;
};

export function useDeploymentLogs(appId: string): DeploymentLogsView {
  const latest = useLatestDeployment(appId);
  const deploymentId = latest.data;
  const timerange = useLogTimerange();
  const logs = useQuery(deploymentLogsQueryOptions({ appId, deploymentId, timerange }));
  const records = logs.data ?? [];

  if (latest.isError) {
    return { status: 'failed', records, deploymentId: undefined, reason: latest.error.message };
  }
  if (logs.isError) {
    return { status: 'failed', records, deploymentId, reason: logs.error.message };
  }
  if (deploymentId === undefined) {
    return { status: 'connecting', records, deploymentId: undefined, reason: undefined };
  }
  return { status: 'following', records, deploymentId, reason: undefined };
}
