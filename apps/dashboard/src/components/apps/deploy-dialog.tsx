import { DeployDialogContent } from '#components/apps/deploy-dialog-content.tsx';
import { DeployRunProvider } from '#lib/providers/deploy-run-provider.tsx';

export function DeployDialog({ appId }: { appId?: string }) {
  return (
    <DeployRunProvider>
      <DeployDialogContent appId={appId} />
    </DeployRunProvider>
  );
}
