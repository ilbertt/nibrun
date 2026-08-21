import { Badge } from '@repo/ui/components/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import { ExternalLinkIcon } from 'lucide-react';
import { AppStatusBadge } from '#components/apps/app-status-badge.tsx';
import { HostnameStateBadge } from '#components/apps/hostname-state-badge.tsx';
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
          <AppStatusBadge app={app} />
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
                <a
                  href={`https://${hostname.hostname}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-1.5 font-mono hover:underline"
                >
                  <span className="truncate">{hostname.hostname}</span>
                  <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" />
                </a>
                <span className="flex shrink-0 items-center gap-2">
                  {hostname.kind === 'custom' ? <Badge variant="outline">Custom</Badge> : null}
                  {/* Only where it says something: a platform hostname is active from the moment
                      it is minted, so a badge on one is a word that never changes. */}
                  {hostname.state === 'active' ? null : (
                    <HostnameStateBadge state={hostname.state} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
