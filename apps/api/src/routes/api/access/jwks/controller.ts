import { Value } from '@sinclair/typebox/value';
import { Elysia, t } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { JWKS_RELAY_ROUTE } from '#lib/jwks-relay.ts';
import { remoteUrlSchema } from '#lib/remote-url.ts';
import { JwksServicePlugin } from '#services/plugins.ts';

export const AccessJwksController = new Elysia().use(JwksServicePlugin).get(
  JWKS_RELAY_ROUTE,
  ({ jwksService, query, set }) => {
    set.headers['Cache-Control'] = 'no-store';
    return jwksService.read({ ...query, ownerId: Value.Parse(OwnerIdSchema, query.ownerId) });
  },
  {
    query: t.Object({
      source: remoteUrlSchema(),
      ownerId: OwnerIdSchema,
      signature: t.String({ pattern: '^[a-f0-9]{64}$' }),
    }),
    detail: { hide: true },
  },
);
