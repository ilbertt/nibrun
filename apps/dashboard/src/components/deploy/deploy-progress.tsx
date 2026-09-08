import type { DeployStep } from '@repo/app-operations';
import { Button } from '@repo/ui/components/button';
import { Spinner } from '@repo/ui/components/spinner';
import { CheckIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { UploadMeter } from '#components/deploy/upload-meter.tsx';
import { useDeployRun } from '#lib/hooks/use-deploy-run.ts';
import { type DeployPhase, isUploading } from '#lib/hooks/use-run-app.ts';

/** Long enough for the app's own tab to be the one in front before this one moves off the run. */
const FOLLOW_DELAY_MS = 1000;

// `done` and `goToApp` are the same trip by two means, and both are the caller's: a dialog closes
// itself where a page of its own has somewhere to go, and this view has no way to know which of
// those it is inside.
export function DeployProgress({ done, goToApp }: { done: ReactNode; goToApp: () => void }) {
  const run = useDeployRun();
  const waiting = waitingOn(run.phase);
  const followToApp = useFollowLater(goToApp);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ol className="flex flex-col gap-2 text-sm">
        {run.steps.map((step) => (
          <li key={step.kind} className="flex items-start gap-2">
            <CheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="wrap-anywhere font-mono">{describeStep(step)}</span>
          </li>
        ))}
        {waiting !== undefined && (
          <li className="flex flex-col gap-2 text-muted-foreground">
            <div className="flex items-center gap-2">
              <Spinner className="shrink-0" />
              <span>{waiting}</span>
            </div>
            {run.progress !== undefined && isUploading(run.phase) && (
              <UploadMeter progress={run.progress} />
            )}
          </li>
        )}
      </ol>

      {run.deployed !== undefined && (
        <div className="flex flex-col gap-1 rounded-2xl bg-muted px-3 py-2 text-sm">
          <span className="text-muted-foreground">Serving at</span>
          {/* The click is for the app, which opens beside this: so this end follows it a moment
              later rather than moving out from under the tab that was just asked for. */}
          <a
            href={run.deployed.url}
            target="_blank"
            rel="noreferrer"
            onClick={followToApp}
            className="wrap-anywhere font-medium font-mono underline underline-offset-4"
          >
            {run.deployed.url}
          </a>
        </div>
      )}

      {run.reason !== undefined && (
        <p className="flex items-start gap-2 rounded-2xl bg-destructive/10 px-3 py-2 text-destructive text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <span className="wrap-anywhere">{run.reason}</span>
        </p>
      )}

      {waiting === undefined && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {run.phase === 'failed' && (
            <Button variant="outline" onClick={run.reset}>
              Deploy another
            </Button>
          )}
          {done}
        </div>
      )}
    </div>
  );
}

/** Cancelled by leaving: a dialog closed in the meantime is a choice to stay, not to follow. */
function useFollowLater(follow: () => void): () => void {
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(pending.current), []);

  return function later(): void {
    clearTimeout(pending.current);
    pending.current = setTimeout(follow, FOLLOW_DELAY_MS);
  };
}

function waitingOn(phase: DeployPhase): string | undefined {
  if (phase === 'uploading') {
    return 'uploading the binary';
  }
  if (phase === 'uploading-data') {
    return 'uploading the data the app starts with';
  }
  // No meter under this one: the bytes are moving between the url and nibrun, and this end is
  // only waiting to be told how it went.
  if (phase === 'fetching') {
    return 'nibrun is fetching the binary';
  }
  if (phase === 'releasing') {
    return 'releasing the binary the app already has';
  }
  return phase === 'settling' ? 'the app is coming online' : undefined;
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
