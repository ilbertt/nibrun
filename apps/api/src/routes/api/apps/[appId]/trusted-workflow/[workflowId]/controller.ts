import { AppIdSchema } from '@repo/protocol';
import { publicSchema } from '@repo/typebox-extensions';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap, t } from 'elysia';
import { OwnerIdSchema, TrustedWorkflowIdSchema } from '#lib/api/identifiers.ts';
import { Identity } from '#lib/auth/plugin.ts';
import {
  SaveTrustedWorkflowRequestSchema,
  TrustedWorkflowResponseSchema,
} from '#routes/api/apps/[appId]/trusted-workflow/model.ts';
import { AuthPlugin, TrustedWorkflowsServicePlugin } from '#services/plugins.ts';

export const AppsAppIdTrustedWorkflowWorkflowIdController = new Elysia()
  .use(AuthPlugin)
  .use(TrustedWorkflowsServicePlugin)
  .guard({ auth: Identity.Required })
  .put(
    '/apps/:appId/trusted-workflow/:workflowId',
    function updateTrustedWorkflow({ trustedWorkflowsService, params, user, body }) {
      return trustedWorkflowsService.update({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        workflowId: Value.Parse(TrustedWorkflowIdSchema, params.workflowId),
        workflow: Value.Parse(SaveTrustedWorkflowRequestSchema, body),
      });
    },
    {
      body: publicSchema(SaveTrustedWorkflowRequestSchema),
      response: publicSchema(TrustedWorkflowResponseSchema),
    },
  )
  .delete(
    '/apps/:appId/trusted-workflow/:workflowId',
    async function removeTrustedWorkflow({ trustedWorkflowsService, params, user, status }) {
      await trustedWorkflowsService.remove({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        workflowId: Value.Parse(TrustedWorkflowIdSchema, params.workflowId),
      });
      return status(StatusMap['No Content'], undefined);
    },
    { response: { [StatusMap['No Content']]: t.Void() } },
  );
