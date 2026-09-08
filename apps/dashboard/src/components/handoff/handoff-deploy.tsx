import { deploySuggestion } from '@repo/deploy-link';
import { Button } from '@repo/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import { Link } from '@tanstack/react-router';
import { DeployForm } from '#components/deploy/deploy-form.tsx';
import { DeployProgress } from '#components/deploy/deploy-progress.tsx';
import { useDeployLink } from '#lib/hooks/use-deploy-link.ts';
import { useDeployRun } from '#lib/hooks/use-deploy-run.ts';
import { useGoToDeployedApp } from '#lib/hooks/use-go-to-deployed-app.ts';
import { Route as AppRoute } from '#routes/(dashboard)/apps/$appId/index.tsx';
import { Route as IndexRoute } from '#routes/(dashboard)/index.tsx';

export function HandoffDeploy({ binary }: { binary: File | undefined }) {
  const run = useDeployRun();
  const link = useDeployLink();
  const minimal = link.minimal ?? false;
  const goToApp = useGoToDeployedApp();

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
            pinnedAction={false}
          />
        ) : (
          <DeployProgress done={<HandoffDoneButton />} goToApp={goToApp} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Nothing is behind this page — it was opened by a drop on another origin — so the run itself has
 * to hand over somewhere to go. The app where there is one, and the dashboard where the deploy
 * failed and made none.
 */
function HandoffDoneButton() {
  const { deployed } = useDeployRun();

  if (deployed === undefined) {
    return <Button render={<Link to={IndexRoute.to} />}>Go to the dashboard</Button>;
  }

  return (
    <Button render={<Link to={AppRoute.to} params={{ appId: deployed.appId }} />}>
      Go to app details
    </Button>
  );
}
