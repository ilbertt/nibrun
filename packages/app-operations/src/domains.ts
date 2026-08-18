import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import { HostnameSchema, Value } from '@repo/protocol';

export type AddDomainInput = { api: PublicApiClient; appId: string; hostname: string };
export type RemoveDomainInput = AddDomainInput;

/**
 * Register a domain the owner brought.
 *
 * What comes back is not a working domain — nothing here can point their DNS at us — but the two
 * records that make it one. Nothing proves ownership beforehand: placing those records is the
 * proof, because a certificate cannot be issued for a name that has not.
 *
 * Parsed here rather than passed through, so a typed domain is refused by the caller that took it
 * rather than by a round trip that comes back a validation error.
 */
export async function addDomain({ api, appId, hostname }: AddDomainInput) {
  return unwrap(
    await api.api.apps({ appId }).hostnames.post({
      hostname: Value.Parse(HostnameSchema, hostname),
    }),
  );
}

export async function removeDomain({ api, appId, hostname }: RemoveDomainInput): Promise<void> {
  unwrap(
    await api.api.apps({ appId }).hostnames.delete(
      {},
      {
        query: { hostname: Value.Parse(HostnameSchema, hostname) },
      },
    ),
  );
}
