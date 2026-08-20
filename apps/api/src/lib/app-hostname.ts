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
  'hostname' | 'kind' | 'state' | 'dcv_target'
>;

/**
 * Whether a hostname is one this platform hands out rather than one an owner may bring.
 *
 * The unique index on `hostname` already stops a brought domain taking a name another app holds,
 * but only once that app exists. Without this, an owner could claim a slug nothing has been
 * minted under yet and be handed it by the platform later — so the reservation is what is being
 * enforced here, not the collision.
 */
export function isPlatformHostname({
  hostname,
  appHostDomain,
}: {
  hostname: Hostname;
  appHostDomain: string;
}): boolean {
  return hostname === appHostDomain || hostname.endsWith(`.${appHostDomain}`);
}

/**
 * What an owner is told about one of their hostnames. More than a host is told: a host is sent
 * only the hostnames it should answer for, so `state` would always read `active` there and the
 * record to place is the owner's business rather than the fleet's.
 */
export type PublicAppHostname = AppHostname & {
  state: AppHostnameState;
  dcvTarget: string | null;
};

export function toAppHostname(row: AppHostnameColumns): PublicAppHostname {
  return {
    hostname: row.hostname,
    kind: row.kind,
    state: row.state,
    dcvTarget: row.dcv_target,
  };
}
