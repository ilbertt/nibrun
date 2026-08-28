import { Badge } from '@repo/ui/components/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import { CopyButton } from '@repo/ui/custom/copy-button';
import { ExternalLinkIcon } from 'lucide-react';
import { AppStatusBadge } from '#components/apps/app-status-badge.tsx';
import { HostnameStateBadge } from '#components/apps/hostname-state-badge.tsx';
import { dayAndMinute } from '#lib/format-timestamp.ts';
import { useNewestDeployment } from '#lib/hooks/use-newest-deployment.ts';
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
        {/* Mounted only for an app that asked, because reading where it answers is a request of
            its own and most apps have nothing to answer on. */}
        {app.config.hasExtraPublicPort && <ReachedOnItsOwnPort appId={app.id} />}
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

/**
 * The address and port an app that asked for one is reached at, which only the host running it
 * knows: it is reported with the release rather than configured, so there is nothing to show until
 * one is running and has said so.
 */
function ReachedOnItsOwnPort({ appId }: { appId: string }) {
  const { publicIpv4, extraPublicPort } = useNewestDeployment(appId).data ?? {};
  return (
    <div className="flex flex-col gap-2">
      {/* Both protocols, always — nibrun never asks which a tenant means to carry over it — so it
          is part of what the row is called rather than something beside the address. */}
      <span className="text-muted-foreground">Additional TCP/UDP address</span>
      {publicIpv4 && extraPublicPort ? (
        // Nothing here links anywhere: it is not a URL, and what an owner does with it is paste it
        // into whatever is dialling the app. Same line as the run command for that reason.
        <ReachedAt address={`${publicIpv4}:${extraPublicPort}`} />
      ) : (
        // Asked for and not yet answered for: the host says where it is on its first report, so
        // this is a release that has not started rather than an address that failed to arrive.
        <span className="text-muted-foreground">assigned when it starts</span>
      )}
    </div>
  );
}

function ReachedAt({ address }: { address: string }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 select-all break-words font-mono text-xs tabular-nums">
        {address}
      </code>
      <CopyButton value={address} />
    </div>
  );
}
