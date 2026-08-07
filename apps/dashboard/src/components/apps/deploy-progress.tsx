import type { DeployStep } from '@repo/app-operations';
import { CheckIcon, TriangleAlertIcon } from 'lucide-react';
import { Button } from '#components/ui/button.tsx';
import { DialogClose } from '#components/ui/dialog.tsx';
import { Spinner } from '#components/ui/spinner.tsx';
import { useDeployRun } from '#lib/hooks/use-deploy-run.ts';
import type { DeployPhase } from '#lib/hooks/use-run-app.ts';

export function DeployProgress() {
  const run = useDeployRun();
  const waiting = waitingOn(run.phase);

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-2 text-sm">
        {run.steps.map((step) => (
          <li key={step.kind} className="flex items-center gap-2">
            <CheckIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono">{describeStep(step)}</span>
          </li>
        ))}
        {waiting !== undefined && (
          <li className="flex items-center gap-2 text-muted-foreground">
            <Spinner className="shrink-0" />
            <span>{waiting}</span>
          </li>
        )}
      </ol>

      {run.deployed !== undefined && (
        <div className="flex flex-col gap-1 rounded-2xl bg-muted px-3 py-2 text-sm">
          <span className="text-muted-foreground">Serving at</span>
          <a
            href={run.deployed.url}
            target="_blank"
            rel="noreferrer"
            className="truncate font-medium font-mono underline underline-offset-4"
          >
            {run.deployed.url}
          </a>
        </div>
      )}

      {run.reason !== undefined && (
        <p className="flex items-start gap-2 rounded-2xl bg-destructive/10 px-3 py-2 text-destructive text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <span>{run.reason}</span>
        </p>
      )}

      {waiting === undefined && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={run.reset}>
            Deploy another
          </Button>
          <DialogClose render={<Button />}>Done</DialogClose>
        </div>
      )}
    </div>
  );
}

function waitingOn(phase: DeployPhase): string | undefined {
  if (phase === 'uploading') {
    return 'uploading the binary';
  }
  return phase === 'settling' ? 'waiting for the guest to answer' : undefined;
}

function describeStep(step: DeployStep): string {
  if (step.kind === 'app') {
    return `app ${step.slug}`;
  }
  if (step.kind === 'artifact') {
    return `artifact ${step.digest}`;
  }
  return `deployment ${step.deploymentId}`;
}
