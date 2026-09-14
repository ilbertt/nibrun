import { Badge } from '@repo/ui/components/badge';
import { Button } from '@repo/ui/components/button';
import { Spinner } from '@repo/ui/components/spinner';
import { RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { DomainRecords } from '#components/apps/domain-records.tsx';
import { HostnameLink } from '#components/apps/hostname-link.tsx';
import { HostnameStateBadge } from '#components/apps/hostname-state-badge.tsx';
import { useAddDomain, useRemoveDomain } from '#lib/hooks/use-app-domains.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import type { AppSummary } from '#queries/apps.ts';

type Hostname = AppSummary['hostnames'][number];

export function DomainRow({ hostname }: { hostname: Hostname }) {
  const appId = useAppId();
  const removal = useRemoveDomain(appId);
  // Said again rather than checked: adding a domain the app already has is what asks the edge.
  const again = useAddDomain(appId);
  // The platform hostname has no remove: it is how the app is addressed once every brought
  // domain has gone, and nothing would put it back.
  const isPlatform = hostname.kind === 'platform';
  // Only a domain still waiting has anything to ask the edge for.
  const isWaiting = !isPlatform && hostname.state === 'pending';

  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <HostnameLink hostname={hostname.hostname} />
        <div className="flex shrink-0 items-center gap-2">
          {isPlatform ? <Badge variant="outline">Issued</Badge> : null}
          <HostnameStateBadge state={hostname.state} />
          {isWaiting ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Check ${hostname.hostname} again`}
              disabled={again.isPending}
              onClick={() => again.mutate(hostname.hostname)}
            >
              {again.isPending ? <Spinner /> : <RefreshCwIcon />}
            </Button>
          ) : null}
          {isPlatform ? null : (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${hostname.hostname}`}
              disabled={removal.isPending}
              onClick={() => removal.mutate(hostname.hostname)}
            >
              {removal.isPending ? <Spinner /> : <Trash2Icon />}
            </Button>
          )}
        </div>
      </div>
      {hostname.state === 'pending' ? <DomainRecords hostname={hostname} /> : null}
    </li>
  );
}
