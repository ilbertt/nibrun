import { publicSchema } from '@repo/typebox-extensions';
import { Value } from '@sinclair/typebox/value';
import { Elysia } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { AuthCaller } from '#lib/auth/caller.ts';
import { ListPaidRequestsResponseSchema } from '#routes/api/paid-requests/model.ts';
import { AuthPlugin, PaidRequestsServicePlugin } from '#services/plugins.ts';

export const PaidRequestsController = new Elysia()
  .use(AuthPlugin)
  .use(PaidRequestsServicePlugin)
  .guard({ auth: { policies: [AuthCaller.RegisteredAccount] } })
  .get(
    '/paid-requests',
    async function listPaidRequests({ paidRequestsService, user }) {
      const requests = await paidRequestsService.list({
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return { requests };
    },
    { response: publicSchema(ListPaidRequestsResponseSchema) },
  );
