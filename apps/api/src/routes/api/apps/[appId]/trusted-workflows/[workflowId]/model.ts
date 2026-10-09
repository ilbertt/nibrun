import { AppIdSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import { TrustedWorkflowIdSchema } from '#lib/api/identifiers.ts';
import { TrustedWorkflowResourceSchema, TrustedWorkflowSchema } from '#lib/api/trusted-workflow.ts';

export const TrustedWorkflowParamsSchema = Type.Object({
  appId: AppIdSchema,
  workflowId: TrustedWorkflowIdSchema,
});
export const UpdateTrustedWorkflowRequestSchema = TrustedWorkflowSchema;
export const UpdateTrustedWorkflowResponseSchema = TrustedWorkflowResourceSchema;
export const DeleteTrustedWorkflowResponseSchema = Type.Void();
