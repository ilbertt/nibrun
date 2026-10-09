import { AppIdSchema } from '@repo/protocol';
import { publicSchema } from '@repo/typebox-extensions';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { Identity } from '#lib/auth/plugin.ts';
import {
  CreateTrustedWorkflowRequestSchema,
  TrustedWorkflowResponseSchema,
} from '#routes/api/apps/[appId]/trusted-workflows/model.ts';
import { AuthPlugin, TrustedWorkflowsServicePlugin } from '#services/plugins.ts';

export const AppsAppIdTrustedWorkflowsController = new Elysia()
  .use(AuthPlugin)
  .use(TrustedWorkflowsServicePlugin)
  .guard({ auth: Identity.Required })
  .get(
    '/apps/:appId/trusted-workflows',
    function findTrustedWorkflow({ trustedWorkflowsService, params, user }) {
      return trustedWorkflowsService.find({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      });
    },
    { response: publicSchema(TrustedWorkflowResponseSchema) },
  )
  .post(
    '/apps/:appId/trusted-workflows',
    async function createTrustedWorkflow({ trustedWorkflowsService, params, user, body, status }) {
      const workflow = await trustedWorkflowsService.create({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        workflow: Value.Parse(CreateTrustedWorkflowRequestSchema, body),
      });
      return status(StatusMap.Created, workflow);
    },
    {
      body: publicSchema(CreateTrustedWorkflowRequestSchema),
      response: { [StatusMap.Created]: publicSchema(TrustedWorkflowResponseSchema) },
    },
  );
