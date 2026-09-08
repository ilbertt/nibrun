import { Button } from '@repo/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/dialog';
import { DialogBody } from '@repo/ui/custom/dialog-body';
import { RocketIcon } from 'lucide-react';
import { useState } from 'react';
import { DeployDoneButton } from '#components/deploy/deploy-done-button.tsx';
import { DeployForm } from '#components/deploy/deploy-form.tsx';
import { DeployProgress } from '#components/deploy/deploy-progress.tsx';
import { useDeployRun } from '#lib/hooks/use-deploy-run.ts';

export function DeployDialogContent({
  appId,
  disabled,
}: {
  appId: string | undefined;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const run = useDeployRun();
  const running = run.phase === 'uploading' || run.phase === 'settling';
  const newApp = appId === undefined;

  function handleOpenChange(next: boolean): void {
    if (next && !running) {
      run.reset();
    }
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={<Button variant={newApp ? 'default' : 'outline'} disabled={disabled} />}
      >
        <RocketIcon data-icon="inline-start" />
        {newApp ? 'Deploy' : 'Update'}
      </DialogTrigger>
      <DialogContent showCloseButton={!running} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{newApp ? 'Deploy a binary' : 'Update'}</DialogTitle>
          <DialogDescription>
            {run.phase === 'idle'
              ? describeDeploy(newApp)
              : 'The release is on its way. Closing this does not stop it.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {run.phase === 'idle' ? (
            <DeployForm
              appId={appId}
              binary={undefined}
              suggested={undefined}
              minimal={false}
              pinnedAction
            />
          ) : (
            <DeployProgress done={<DeployDoneButton />} />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function describeDeploy(newApp: boolean): string {
  return newApp
    ? 'The binary is uploaded to the store, then released as what the app runs.'
    : 'The app is released again with whatever this leaves it set to. A binary replaces the one it runs; without one, it keeps it.';
}
