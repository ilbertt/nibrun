import { RocketIcon } from 'lucide-react';
import { useState } from 'react';
import { DeployForm } from '#components/apps/deploy-form.tsx';
import { DeployProgress } from '#components/apps/deploy-progress.tsx';
import { Button } from '#components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#components/ui/dialog.tsx';
import { useDeployRun } from '#lib/hooks/use-deploy-run.ts';

export function DeployDialogContent({ appId }: { appId?: string }) {
  const [open, setOpen] = useState(false);
  const run = useDeployRun();
  const running = run.phase === 'uploading' || run.phase === 'settling';

  function handleOpenChange(next: boolean): void {
    if (next && !running) {
      run.reset();
    }
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant={appId === undefined ? 'default' : 'outline'} />}>
        <RocketIcon data-icon="inline-start" />
        Deploy
      </DialogTrigger>
      <DialogContent showCloseButton={!running} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Deploy a binary</DialogTitle>
          <DialogDescription>
            {run.phase === 'idle'
              ? 'The binary is uploaded to the store, then released as what the app runs.'
              : 'The binary is on its way. Closing this does not stop it.'}
          </DialogDescription>
        </DialogHeader>
        {run.phase === 'idle' ? <DeployForm appId={appId} /> : <DeployProgress />}
      </DialogContent>
    </Dialog>
  );
}
