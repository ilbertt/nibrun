import { DeployDialogContent } from '#components/apps/deploy-dialog-content.tsx';
import type { AppActionAvailability } from '#lib/app-actions.ts';
import { DeployRunProvider } from '#lib/providers/deploy-run-provider.tsx';

export function DeployDialog({
  appId,
  availability = 'enabled',
}: {
  appId?: string;
  /** The apps page deploys with no app behind it, and so with no status to withhold it. */
  availability?: AppActionAvailability;
}) {
  if (availability === 'hidden') {
    return null;
  }

  return (
    <DeployRunProvider>
      <DeployDialogContent appId={appId} disabled={availability === 'disabled'} />
    </DeployRunProvider>
  );
}
