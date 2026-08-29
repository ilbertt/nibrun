import { DeployDialogContent } from '#components/deploy/deploy-dialog-content.tsx';
import { type AppActionAvailability, ENABLED, greyedReason } from '#lib/app-actions.ts';
import { DeployRunProvider } from '#lib/providers/deploy-run-provider.tsx';

export function DeployDialog({
  appId,
  availability = ENABLED,
}: {
  appId?: string;
  /** The apps page deploys with no app behind it, and so with no status to withhold it. */
  availability?: AppActionAvailability;
}) {
  if (availability.kind === 'hidden') {
    return null;
  }

  return (
    // A greyed button takes no pointer events of its own, so the reason it is greyed is hung on
    // what is around it.
    <span className="inline-flex" title={greyedReason(availability)}>
      <DeployRunProvider>
        <DeployDialogContent appId={appId} disabled={availability.kind === 'disabled'} />
      </DeployRunProvider>
    </span>
  );
}
