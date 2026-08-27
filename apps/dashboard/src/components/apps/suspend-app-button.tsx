import { Button } from '@repo/ui/components/button';
import { Spinner } from '@repo/ui/components/spinner';
import { PauseIcon, PlayIcon } from 'lucide-react';
import type { AppActionAvailability } from '#lib/app-actions.ts';
import type { AppTransition } from '#lib/app-status.ts';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useAppStatus } from '#lib/hooks/use-app-status.ts';
import { useAppSuspension } from '#lib/hooks/use-app-suspension.ts';
import { useFailureToast } from '#lib/hooks/use-failure-toast.ts';

/** What the button says while the host is catching up with what it was last pressed for. */
const WHILE_MOVING: Record<AppTransition, string> = {
  suspending: 'Suspending',
  resuming: 'Resuming',
};

/**
 * One button rather than two, because there is one thing to say about a running app and one about
 * a suspended one. Nothing here is confirmed: what suspending costs is the app's uptime, and the
 * undo is this same button.
 *
 * It stays down until the microVM has actually stopped or come back, because until then the app
 * row it would read to decide what to do next says something the host has not done yet.
 */
export function SuspendAppButton({ availability }: { availability: AppActionAvailability }) {
  const appId = useAppId();
  const app = useApp(appId);
  const status = useAppStatus(app.data);
  const suspension = useAppSuspension(appId);
  useFailureToast(suspension.error?.message);

  if (availability === 'hidden') {
    return null;
  }

  const suspended = app.data?.state === 'suspended';
  const Icon = suspended ? PlayIcon : PauseIcon;
  const moving = status.status?.kind === 'transition' ? status.status.label : undefined;
  const waiting = availability === 'disabled' || suspension.isPending;

  return (
    <Button
      variant="outline"
      disabled={waiting}
      onClick={() => suspension.mutate(suspended ? 'active' : 'suspended')}
    >
      {waiting ? <Spinner data-icon="inline-start" /> : <Icon data-icon="inline-start" />}
      {moving ? WHILE_MOVING[moving] : suspended ? 'Resume' : 'Suspend'}
    </Button>
  );
}
