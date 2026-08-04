import type { DnsLabel, Hostname } from '@repo/protocol';

/**
 * The app domain is a different registrable domain from the one the dashboard is served on, so
 * a tenant app cannot read the dashboard's cookies. Terraform enforces that; this only joins.
 */
export function platformHostname({
  slug,
  appHostDomain,
}: {
  slug: DnsLabel;
  appHostDomain: string;
}): Hostname {
  return `${slug}.${appHostDomain}` as Hostname;
}
