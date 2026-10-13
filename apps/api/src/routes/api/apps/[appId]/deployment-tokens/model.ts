import { AppIdSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import { DeploymentTokenResourceSchema } from '#lib/api/deployment-token.ts';

export const IssueDeploymentTokenParamsSchema = Type.Object({ appId: AppIdSchema });
export const DeploymentTokenResponseSchema = DeploymentTokenResourceSchema;
