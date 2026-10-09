import { AppIdSchema } from '@repo/protocol';
import { publicSchema } from '@repo/typebox-extensions';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap, t } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { Identity } from '#lib/auth/plugin.ts';
import {
  SaveTrustedWorkflowRequestSchema,
  TrustedWorkflowResponseSchema,
} from '#routes/api/apps/[appId]/trusted-workflow/model.ts';
import { AuthPlugin, TrustedWorkflowsServicePlugin } from '#services/plugins.ts';

export const AppsAppIdTrustedWorkflowController = new Elysia()
  .use(AuthPlugin)
  .use(TrustedWorkflowsServicePlugin)
  .guard({ auth: Identity.Required })
  .get(
    '/apps/:appId/trusted-workflow',
    ({ trustedWorkflowsService, params, user }) =>
      trustedWorkflowsService.find({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      }),
    { response: publicSchema(TrustedWorkflowResponseSchema) },
  )
  .put(
    '/apps/:appId/trusted-workflow',
    ({ trustedWorkflowsService, params, user, body }) =>
      trustedWorkflowsService.save({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        workflow: Value.Parse(SaveTrustedWorkflowRequestSchema, body),
      }),
    {
      body: publicSchema(SaveTrustedWorkflowRequestSchema),
      response: publicSchema(TrustedWorkflowResponseSchema),
    },
  )
  .delete(
    '/apps/:appId/trusted-workflow',
    async ({ trustedWorkflowsService, params, user, status }) => {
      await trustedWorkflowsService.remove({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
      return status(StatusMap['No Content'], undefined);
    },
    { response: { [StatusMap['No Content']]: t.Void() } },
  );
