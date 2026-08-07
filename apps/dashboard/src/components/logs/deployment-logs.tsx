import { DeploymentLine } from '#components/apps/deployment-line.tsx';
import { FailureEmpty } from '#components/failure-empty.tsx';
import { LogStream } from '#components/logs/log-stream.tsx';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useDeploymentLogs } from '#lib/hooks/use-deployment-logs.ts';
import { useFailureToast } from '#lib/hooks/use-failure-toast.ts';

export function DeploymentLogs() {
  const appId = useAppId();
  const logs = useDeploymentLogs(appId);

  useFailureToast(logs.reason);

  if (logs.status === 'failed' && logs.records.length === 0) {
    return <FailureEmpty title="Could not follow the output" reason={logs.reason ?? ''} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {logs.deploymentId === undefined ? (
        <p className="text-muted-foreground text-xs">Finding the current deployment…</p>
      ) : (
        <DeploymentLine deploymentId={logs.deploymentId} />
      )}
      <LogStream records={logs.records} />
    </div>
  );
}
