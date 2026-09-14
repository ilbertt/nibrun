import {
  type AppHostname,
  type AppHostnameState,
  type DnsLabel,
  type Hostname,
  HostnameSchema,
  type Timestamp,
  Value,
} from '@repo/protocol';
import { getDomain } from 'tldts';
import type { Queries } from '#db/queries.gen.ts';
import { toTimestamp } from '#lib/timestamp.ts';

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
  'hostname' | 'kind' | 'state' | 'dcv_target' | 'edge_errors' | 'created_at'
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

/** How the edge is asked to prove a hostname before issuing its certificate. */
export type DcvMethod = 'txt' | 'http';

/**
 * Delegated TXT lets the certificate be issued before any traffic moves, and it is what every
 * subdomain gets. It cannot be trusted at a zone apex: a zone on Cloudflare proves its own
 * certificate through TXT records at `_acme-challenge.<apex>`, kept out of the owner's sight, and
 * Cloudflare answers TXT queries for that name from those rather than following the CNAME the
 * owner placed for us — so validation waits until Cloudflare's own tokens are withdrawn, which
 * took four hours the day it was noticed. HTTP asks nothing of that name: once the domain points
 * at us the edge serves the token itself, and renews the same way.
 *
 * Every apex rather than only the ones on Cloudflare: an apex can only point at us from a
 * provider that flattens CNAMEs, whose apex is a zone somewhere either way, and finding out
 * whose would be a DNS lookup on the owner's request. The price is the pre-issued certificate,
 * which a subdomain keeps.
 */
export function dcvMethodFor(hostname: Hostname): DcvMethod {
  return getDomain(hostname) === hostname ? 'http' : 'txt';
}

/**
 * What an owner is told about one of their hostnames. More than a host is told: a host is sent
 * only the hostnames it should answer for, so `state` would always read `active` there and the
 * record to place is the owner's business rather than the fleet's.
 */
export type PublicAppHostname = AppHostname & {
  state: AppHostnameState;
  dcvTarget: string | null;
  edgeErrors: string[];
  createdAt: Timestamp;
};

export function toAppHostname(row: AppHostnameColumns): PublicAppHostname {
  return {
    hostname: row.hostname,
    kind: row.kind,
    state: row.state,
    dcvTarget: row.dcv_target,
    edgeErrors: row.edge_errors,
    createdAt: toTimestamp(row.created_at),
  };
}
