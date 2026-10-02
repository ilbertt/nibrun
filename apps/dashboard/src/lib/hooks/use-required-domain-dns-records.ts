import { type RequiredDomainDnsRecord, requiredDomainDnsRecords } from '@repo/protocol';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import type { AppSummary } from '#queries/apps.ts';

export function useRequiredDomainDnsRecords(
  hostname: AppSummary['hostnames'][number],
): RequiredDomainDnsRecord[] {
  const app = useApp(useAppId());
  const platform = app.data?.hostnames.find((each) => each.kind === 'platform');
  if (platform === undefined) {
    return [];
  }
  return requiredDomainDnsRecords({
    hostname: hostname.hostname,
    routingTarget: platform.hostname,
    dcvTarget: hostname.dcvTarget ?? undefined,
  });
}
