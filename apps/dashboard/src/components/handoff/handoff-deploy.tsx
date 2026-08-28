import { Button } from '@repo/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/card';
import { Link } from '@tanstack/react-router';
import { DeployForm } from '#components/apps/deploy-form.tsx';
import { DeployProgress } from '#components/apps/deploy-progress.tsx';
import type { DeploySuggestion } from '#lib/deploy-link.ts';
import { useDeployRun } from '#lib/hooks/use-deploy-run.ts';
import type { DeployPhase } from '#lib/hooks/use-run-app.ts';
import { Route as IndexRoute } from '#routes/(dashboard)/index.tsx';

export function HandoffDeploy({
  binary,
  suggested,
}: {
  binary: File | undefined;
  suggested?: DeploySuggestion | undefined;
}) {
  const run = useDeployRun();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          {binary === undefined ? 'Deploy a binary' : 'Deploy this binary'}
        </CardTitle>
        <CardDescription>{describe({ phase: run.phase, binary })}</CardDescription>
      </CardHeader>
      <CardContent>
        {run.phase === 'idle' ? (
          <DeployForm appId={undefined} binary={binary} suggested={suggested} />
        ) : (
          // Only ever seen when the deploy failed: a run that lands leaves for the app it made
          // on its own, and a failed one made none to offer.
          <DeployProgress
            done={<Button render={<Link to={IndexRoute.to} />}>Go to the dashboard</Button>}
          />
        )}
      </CardContent>
    </Card>
  );
}

function describe({ phase, binary }: { phase: DeployPhase; binary: File | undefined }): string {
  if (phase !== 'idle') {
    return 'The binary is on its way. The dashboard takes over once it lands.';
  }
  // Nothing was handed over, so whoever followed the link still has to produce the binary —
  // and nibrun compiles nothing, so saying where it comes from is the whole instruction.
  return binary === undefined
    ? 'Compile it on your own machine, then pick it below.'
    : 'It is uploaded to the store, then released as what the app runs.';
}
