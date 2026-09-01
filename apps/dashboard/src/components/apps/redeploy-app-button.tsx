import { Button } from '@repo/ui/components/button';
import { Spinner } from '@repo/ui/components/spinner';
import { RotateCcwIcon } from 'lucide-react';
import type { AppActionAvailability } from '#lib/app-actions.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useAppRedeploy } from '#lib/hooks/use-app-redeploy.ts';

/**
 * The one thing there is to offer a release that did not come up: the same binary again, on the
 * config it already has. Nothing is asked and nothing is confirmed, because nothing is being
 * changed — an owner who wants it to start differently has the deploy button beside this one.
 *
 * How it went is a toast rather than a panel of its own. A release that lands takes the button
 * with it, the app no longer being failed, and one that does not leaves it here to press again.
 */
export function RedeployAppButton({ availability }: { availability: AppActionAvailability }) {
  const appId = useAppId();
  const { releasing, start } = useAppRedeploy(appId);

  if (availability.kind === 'hidden' || start === undefined) {
    return null;
  }

  return (
    <Button
      variant="outline"
      disabled={availability.kind === 'disabled' || releasing}
      onClick={start}
    >
      {releasing ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <RotateCcwIcon data-icon="inline-start" />
      )}
      {releasing ? 'Redeploying' : 'Redeploy'}
    </Button>
  );
}
