import { useApp } from '#lib/hooks/use-app.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { usePlatformSuffix } from '#lib/hooks/use-platform-suffix.ts';
import type { AppSummary } from '#queries/apps.ts';

type Hostname = AppSummary['hostnames'][number];

/**
 * The two records a pending domain is waiting on, laid out the way a DNS provider asks for them.
 *
 * Selectable text rather than a copy button per field: these are pasted into somebody else's
 * form, usually more than once, and often not by the person reading this page.
 */
export function DomainRecords({ hostname }: { hostname: Hostname }) {
  const app = useApp(useAppId());
  const suffix = usePlatformSuffix();

  return (
    <dl className="flex flex-col gap-2 rounded-xl bg-muted px-3 py-2 font-mono text-xs">
      <DomainRecord name={hostname.hostname} value={`${app.data?.slug}.${suffix}`} />
      {hostname.dcvTarget ? (
        <DomainRecord name={`_acme-challenge.${hostname.hostname}`} value={hostname.dcvTarget} />
      ) : null}
    </dl>
  );
}

function DomainRecord({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="truncate text-muted-foreground">{name}</dt>
      <dd className="select-all truncate">CNAME {value}</dd>
    </div>
  );
}
