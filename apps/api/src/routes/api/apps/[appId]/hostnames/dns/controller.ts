import { AppIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { Identity } from '#lib/auth/plugin.ts';
import {
  DomainDnsQuerySchema,
  DomainDnsResponseSchema,
} from '#routes/api/apps/[appId]/hostnames/dns/model.ts';
import { AuthPlugin, DomainDnsServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdHostnamesDnsController = new Elysia()
  .use(loggerPlugin('appsAppIdHostnamesDnsController'))
  .use(AuthPlugin)
  .use(DomainDnsServicePlugin)
  .onRequest(({ set }) => {
    set.headers['cache-control'] = 'no-store';
  })
  .get(
    '/apps/:appId/hostnames/dns',
    async ({ domainDnsService, params, query, user }) => {
      const result = await domainDnsService.check({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        hostname: query.hostname,
      });
      return result;
    },
    {
      auth: Identity.Required,
      query: DomainDnsQuerySchema,
      response: { [StatusMap.OK]: DomainDnsResponseSchema },
    },
  );
