import { publicSchema } from '@repo/typebox-extensions';
import { Value } from '@sinclair/typebox/value';
import { Elysia } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { PaidRequestSchema } from '#lib/api/paid-request.ts';
import { AuthCaller } from '#lib/auth/caller.ts';
import {
  PaidRequestParamsSchema,
  SavePaidRequestBodySchema,
} from '#routes/api/paid-requests/[requestType]/model.ts';
import { AuthPlugin, PaidRequestsServicePlugin } from '#services/plugins.ts';

export const PaidRequestsRequestTypeController = new Elysia()
  .use(AuthPlugin)
  .use(PaidRequestsServicePlugin)
  .guard({ auth: { policies: [AuthCaller.RegisteredAccount] } })
  .put(
    '/paid-requests/:requestType',
    function savePaidRequest({ paidRequestsService, user, params, body }) {
      return paidRequestsService.save({
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        request: Value.Parse(PaidRequestSchema, { requestType: params.requestType, ...body }),
      });
    },
    {
      params: publicSchema(PaidRequestParamsSchema),
      body: publicSchema(SavePaidRequestBodySchema),
      response: publicSchema(PaidRequestSchema),
    },
  );
