import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import { DeploymentHistoryContent } from '#components/apps/deployment-history-content.tsx';
import { DeploymentSettingsDialog } from '#components/apps/deployment-settings-dialog.tsx';
import { useAppId } from '#lib/hooks/use-app-id.ts';

export function DeploymentHistory() {
  const appId = useAppId();

  // A card that happens to hold a table, rather than a table in a card: the title is the card's and
  // the rows are one thing it shows. It keeps its own padding above and below, so the rows stop
  // short of the edges and the rivets have face to sit on; only the sides are given over, so a row
  // still runs the full width.
  return (
    <Card>
      <CardHeader className="items-center px-4">
        <CardTitle>Deployments</CardTitle>
        <CardAction className="self-center">
          <DeploymentSettingsDialog key={appId} />
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        <DeploymentHistoryContent />
      </CardContent>
    </Card>
  );
}
