import { Badge } from '@repo/ui/components/badge';
import { Button } from '@repo/ui/components/button';
import { Spinner } from '@repo/ui/components/spinner';
import { Trash2Icon } from 'lucide-react';
import { DomainRecords } from '#components/apps/domain-records.tsx';
import { HostnameLink } from '#components/apps/hostname-link.tsx';
import { HostnameStateBadge } from '#components/apps/hostname-state-badge.tsx';
import { useRemoveDomain } from '#lib/hooks/use-app-domains.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import type { AppSummary } from '#queries/apps.ts';

type Hostname = AppSummary['hostnames'][number];

export function DomainRow({ hostname }: { hostname: Hostname }) {
  const removal = useRemoveDomain(useAppId());
  // The platform hostname has no remove: it is how the app is addressed once every brought
  // domain has gone, and nothing would put it back.
  const isPlatform = hostname.kind === 'platform';

  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <HostnameLink hostname={hostname.hostname} />
        <div className="flex shrink-0 items-center gap-2">
          {isPlatform ? <Badge variant="outline">Issued</Badge> : null}
          <HostnameStateBadge state={hostname.state} />
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
