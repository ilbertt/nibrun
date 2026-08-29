import { Button } from '@repo/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import { Link } from '@tanstack/react-router';
import { DeployForm } from '#components/apps/deploy-form.tsx';
import { DeployProgress } from '#components/apps/deploy-progress.tsx';
import { deploySuggestion } from '#lib/deploy-link.ts';
import { useDeployLink } from '#lib/hooks/use-deploy-link.ts';
import { useDeployRun } from '#lib/hooks/use-deploy-run.ts';
import { Route as IndexRoute } from '#routes/(dashboard)/index.tsx';

export function HandoffDeploy({ binary }: { binary: File | undefined }) {
  const run = useDeployRun();
  const link = useDeployLink();
  const minimal = link.minimal ?? false;

  return (
    <Card>
      {/* A link that asks for less is answered by the drop target alone: it says what to do with
          itself, and a heading above it would only say it again. */}
      {!minimal && (
        <CardHeader>
          <CardTitle className="text-xl">Deploy your app</CardTitle>
        </CardHeader>
      )}
      <CardContent>
        {run.phase === 'idle' ? (
          <DeployForm
            appId={undefined}
            binary={binary}
            suggested={deploySuggestion(link)}
            minimal={minimal}
          />
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
