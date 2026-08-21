import { Button } from '@repo/ui/components/button';
import { Spinner } from '@repo/ui/components/spinner';
import { PauseIcon, PlayIcon } from 'lucide-react';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useAppSuspension } from '#lib/hooks/use-app-suspension.ts';
import { useFailureToast } from '#lib/hooks/use-failure-toast.ts';

/**
 * One button rather than two, because there is one thing to say about a running app and one about
 * a suspended one. Nothing here is confirmed: what suspending costs is the app's uptime, and the
 * undo is this same button.
 */
export function SuspendAppButton() {
  const appId = useAppId();
  const app = useApp(appId);
  const suspension = useAppSuspension(appId);
  useFailureToast(suspension.error?.message);

  const state = app.data?.state;
  const suspended = state === 'suspended';
  const Icon = suspended ? PlayIcon : PauseIcon;
  // An app on its way out is not one to take offline, and the api refuses it either way.
  const going = state === 'deleting' || state === 'deleted';

  return (
    <Button
      variant="outline"
      disabled={state === undefined || going || suspension.isPending}
      onClick={() => suspension.mutate(suspended ? 'active' : 'suspended')}
    >
      {suspension.isPending ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <Icon data-icon="inline-start" />
      )}
      {suspended ? 'Resume' : 'Suspend'}
    </Button>
  );
}
