import { DeployDialog } from '#components/apps/deploy-dialog.tsx';
import { ExportAppDialog } from '#components/apps/export-app-dialog.tsx';
import { useAppId } from '#lib/hooks/use-app-id.ts';

export function AppActions() {
  const appId = useAppId();

  return (
    <div className="flex shrink-0 items-center gap-2">
      <DeployDialog appId={appId} />
      <ExportAppDialog />
    </div>
  );
}
