import { DeleteAppDialog } from '#components/apps/delete-app-dialog.tsx';
import { ExportAppDialog } from '#components/apps/export-app-dialog.tsx';
import { RedeployAppButton } from '#components/apps/redeploy-app-button.tsx';
import { SuspendAppButton } from '#components/apps/suspend-app-button.tsx';
import { DeployDialog } from '#components/deploy/deploy-dialog.tsx';
import { useAppActions } from '#lib/hooks/use-app-actions.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';

/** The one place the table is read: every button here is handed what the app's status allows it. */
export function AppActions() {
  const appId = useAppId();
  const actions = useAppActions(appId);

  return (
    <div className="flex shrink-0 items-center gap-2">
      <DeployDialog appId={appId} availability={actions.deploy} />
      <RedeployAppButton availability={actions.redeploy} />
      <ExportAppDialog availability={actions.export} />
      <SuspendAppButton availability={actions.suspend} />
      <DeleteAppDialog availability={actions.delete} />
    </div>
  );
}
