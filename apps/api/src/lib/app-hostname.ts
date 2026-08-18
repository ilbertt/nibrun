import {
  type AppHostname,
  type AppHostnameState,
  type DnsLabel,
  type Hostname,
  HostnameSchema,
  Value,
} from '@repo/protocol';
import type { Queries } from '#db/queries.gen.d.ts';

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
  return Value.Parse(HostnameSchema, `${slug}.${appHostDomain}`);
}

// Keys named once here, types taken from the query, so renaming a column fails to compile rather
// than silently reading undefined.
export type AppHostnameColumns = Pick<
  Queries['SelectAppHostnamesByApp'],
  'hostname' | 'kind' | 'state'
>;

/**
 * What an owner is told about one of their hostnames. More than a host is told: a host is sent
 * only the hostnames it should answer for, so `state` would always read `active` there.
 */
export type PublicAppHostname = AppHostname & { state: AppHostnameState };

export function toAppHostname(row: AppHostnameColumns): PublicAppHostname {
  return {
    hostname: row.hostname,
    kind: row.kind,
    state: row.state,
  };
}
