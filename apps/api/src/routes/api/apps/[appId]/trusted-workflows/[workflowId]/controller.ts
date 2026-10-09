import { AppIdSchema } from '@repo/protocol';
import { publicSchema } from '@repo/typebox-extensions';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap } from 'elysia';
import { OwnerIdSchema, TrustedWorkflowIdSchema } from '#lib/api/identifiers.ts';
import { Identity } from '#lib/auth/plugin.ts';
import {
  DeleteTrustedWorkflowResponseSchema,
  TrustedWorkflowParamsSchema,
  UpdateTrustedWorkflowRequestSchema,
  UpdateTrustedWorkflowResponseSchema,
} from '#routes/api/apps/[appId]/trusted-workflows/[workflowId]/model.ts';
import { AuthPlugin, TrustedWorkflowsServicePlugin } from '#services/plugins.ts';

export const AppsAppIdTrustedWorkflowsWorkflowIdController = new Elysia()
  .use(AuthPlugin)
  .use(TrustedWorkflowsServicePlugin)
  .guard({ auth: Identity.Required })
  .put(
    '/apps/:appId/trusted-workflows/:workflowId',
    function updateTrustedWorkflow({ trustedWorkflowsService, params, user, body }) {
      return trustedWorkflowsService.update({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        workflowId: Value.Parse(TrustedWorkflowIdSchema, params.workflowId),
        workflow: Value.Parse(UpdateTrustedWorkflowRequestSchema, body),
      });
    },
    {
      params: publicSchema(TrustedWorkflowParamsSchema),
      body: publicSchema(UpdateTrustedWorkflowRequestSchema),
      response: publicSchema(UpdateTrustedWorkflowResponseSchema),
    },
  )
  .delete(
    '/apps/:appId/trusted-workflows/:workflowId',
    async function removeTrustedWorkflow({ trustedWorkflowsService, params, user, status }) {
      await trustedWorkflowsService.remove({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        workflowId: Value.Parse(TrustedWorkflowIdSchema, params.workflowId),
      });
      return status(StatusMap['No Content'], undefined);
    },
    {
      params: publicSchema(TrustedWorkflowParamsSchema),
      response: { [StatusMap['No Content']]: DeleteTrustedWorkflowResponseSchema },
    },
  );
