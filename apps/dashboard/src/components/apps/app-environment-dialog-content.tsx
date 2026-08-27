import { Button } from '@repo/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/dialog';
import { Field, FieldError } from '@repo/ui/components/field';
import { DialogBody } from '@repo/ui/custom/dialog-body';
import { PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { DeployProgress } from '#components/apps/deploy-progress.tsx';
import { EnvironmentTable } from '#components/apps/environment-table.tsx';
import { useDeployRun } from '#lib/hooks/use-deploy-run.ts';
import { useEnvironmentForm } from '#lib/hooks/use-environment-form.ts';
import type { AppSummary } from '#queries/apps.ts';

export function AppEnvironmentDialogContent({ app }: { app: AppSummary }) {
  const [open, setOpen] = useState(false);
  const run = useDeployRun();
  const form = useEnvironmentForm(app);
  const releasing = run.phase === 'releasing' || run.phase === 'settling';

  function handleOpenChange(next: boolean): void {
    if (next && !releasing) {
      run.reset();
      form.reset();
    }
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="xs" />}>
        <PencilIcon data-icon="inline-start" />
        Edit
      </DialogTrigger>
      <DialogContent showCloseButton={!releasing} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Environment variables</DialogTitle>
          <DialogDescription>
            {run.phase === 'idle'
              ? `Saving releases ${app.slug} again on the binary it already runs. Its hostnames and everything on its volume stay as they are.`
              : 'The release is on its way. Closing this does not stop it.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {run.phase === 'idle' ? (
            <form
              className="flex min-w-0 flex-col gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                form.submit();
              }}
            >
              <Field data-invalid={form.error !== undefined || undefined}>
                <EnvironmentTable variables={form.variables} onChange={form.change} />
                {form.error !== undefined && <FieldError>{form.error}</FieldError>}
              </Field>
              <Button type="submit" size="lg" disabled={!form.submittable}>
                <span className="truncate">Save and redeploy {app.slug}</span>
              </Button>
            </form>
          ) : (
            <DeployProgress done={<DialogClose render={<Button />}>Done</DialogClose>} />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
