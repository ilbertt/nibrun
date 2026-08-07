import { AppStateBadge } from '#components/apps/app-state-badge.tsx';
import { Badge } from '#components/ui/badge.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '#components/ui/card.tsx';
import { dayAndMinute } from '#lib/format-timestamp.ts';
import type { AppSummary } from '#queries/apps.ts';

export function AppOverviewCard({ app }: { app: AppSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>App</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">State</span>
          <AppStateBadge state={app.state} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Last change</span>
          <span className="tabular-nums">{dayAndMinute(app.updatedAt)}</span>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground">Hostnames</span>
          <ul className="flex flex-col gap-2">
            {app.hostnames.map((hostname) => (
              <li key={hostname.hostname} className="flex items-center justify-between gap-4">
                <span className="truncate font-mono">{hostname.hostname}</span>
                <Badge variant="outline">{hostname.kind}</Badge>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
