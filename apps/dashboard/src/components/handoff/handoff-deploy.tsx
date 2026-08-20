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
import { useDeployRun } from '#lib/hooks/use-deploy-run.ts';
import type { DeployPhase } from '#lib/hooks/use-run-app.ts';
import { Route as IndexRoute } from '#routes/(dashboard)/index.tsx';

export function HandoffDeploy({ binary }: { binary: File }) {
  const run = useDeployRun();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Deploy this binary</CardTitle>
        <CardDescription>{describe(run.phase)}</CardDescription>
      </CardHeader>
      <CardContent>
        {run.phase === 'idle' ? (
          <DeployForm appId={undefined} binary={binary} />
        ) : (
          // Only ever seen when the deploy failed: a run that lands leaves for the dashboard
          // on its own, so there is nothing here to click.
          <DeployProgress
            done={<Button render={<Link to={IndexRoute.to} />}>Go to the dashboard</Button>}
          />
        )}
      </CardContent>
    </Card>
  );
}

function describe(phase: DeployPhase): string {
  return phase === 'idle'
    ? 'It is uploaded to the store, then released as what the app runs.'
    : 'The binary is on its way. The dashboard takes over once it lands.';
}
