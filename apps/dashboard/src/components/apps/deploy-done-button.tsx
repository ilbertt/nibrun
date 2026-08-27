import { Button } from '@repo/ui/components/button';
import { DialogClose } from '@repo/ui/components/dialog';
import { Link } from '@tanstack/react-router';
import { useDeployRun } from '#lib/hooks/use-deploy-run.ts';
import { Route as AppRoute } from '#routes/(dashboard)/apps/$appId/index.tsx';

// A run that landed has somewhere to go: the app it landed on, which the page behind the dialog
// is not necessarily showing. A run that failed produced no app to leave for.
export function DeployDoneButton() {
  const { deployed } = useDeployRun();

  if (deployed === undefined) {
    return <DialogClose render={<Button />}>Done</DialogClose>;
  }

  return (
    <DialogClose
      render={<Button render={<Link to={AppRoute.to} params={{ appId: deployed.appId }} />} />}
    >
      Done
    </DialogClose>
  );
}
