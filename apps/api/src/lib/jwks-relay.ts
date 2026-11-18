import { createHmac, timingSafeEqual } from 'node:crypto';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import type { TenantSecretsKey } from '#lib/tenant-secrets.ts';

export const JWKS_RELAY_ROUTE = '/access/jwks';
type KeySource = { source: string; ownerId: OwnerId; key: TenantSecretsKey };

function signature({ key, source, ownerId }: KeySource): string {
  return createHmac('sha256', key)
    .update(JSON.stringify(['app-jwks', ownerId, source]))
    .digest('hex');
}

export function jwksRelayUrl({ origin, ...input }: KeySource & { origin: URL }): string {
  const url = new URL(RoutePrefix.Api + JWKS_RELAY_ROUTE, origin);
  url.search = new URLSearchParams({
    source: input.source,
    ownerId: input.ownerId,
    signature: signature(input),
  }).toString();
  return url.href;
}

export function acceptsKeySource({ binding, ...input }: KeySource & { binding: string }): boolean {
  const expected = Buffer.from(signature(input));
  const presented = Buffer.from(binding);
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}
