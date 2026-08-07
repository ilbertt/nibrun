import { useApp } from '#lib/hooks/use-app.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';

export function DeploymentLine({ deploymentId }: { deploymentId: string }) {
  const appId = useAppId();
  const app = useApp(appId);

  return (
    <p className="font-mono text-muted-foreground text-xs">
      {app.data?.slug ?? appId} · deployment {deploymentId}
    </p>
  );
}
