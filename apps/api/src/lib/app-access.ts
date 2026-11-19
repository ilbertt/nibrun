import { type AppAccessPolicy, AppAccessPolicySchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { Queries } from '#db/queries.gen.ts';

type AccessColumns = Pick<
  Queries['SelectAppById'],
  Extract<keyof Queries['SelectAppById'], `access_${string}`>
>;

export function appAccess(row: AccessColumns): AppAccessPolicy {
  if (row.access_kind === 'public') {
    return { kind: 'public' };
  }
  const policy = {
    kind: row.access_kind,
    issuer: row.access_issuer,
    audiences: row.access_audiences,
    token: { header: row.access_header, format: row.access_format },
    publicKeys: { url: row.access_jwks_url },
  };
  Value.Assert(AppAccessPolicySchema, policy);
  return policy;
}

export function accessColumns(access: AppAccessPolicy): AccessColumns {
  const jwt = access.kind === 'jwt' ? access : undefined;
  return {
    access_kind: access.kind,
    access_header: jwt?.token.header ?? null,
    access_format: jwt?.token.format ?? null,
    access_issuer: jwt?.issuer ?? null,
    access_audiences: jwt?.audiences ?? null,
    access_jwks_url: jwt?.publicKeys.url ?? null,
  };
}
