import { Type } from '@sinclair/typebox';
import { AppConfigSchema } from '#domain/app.ts';
import { AppIdSchema, ArtifactIdSchema, DeploymentIdSchema } from '#domain/identifiers.ts';
import { stringEnum } from '#lib/string-enum.ts';
import { TimestampSchema } from '#lib/wire.ts';

export const DEPLOYMENT_STATES = ['pending', 'starting', 'active', 'superseded', 'failed'] as const;

export const DeploymentStateSchema = stringEnum(DEPLOYMENT_STATES);

export type DeploymentState = typeof DeploymentStateSchema.static;

export const DeploymentSchema = Type.Object({
  id: DeploymentIdSchema,
  appId: AppIdSchema,
  artifactId: ArtifactIdSchema,
  config: AppConfigSchema,
  state: DeploymentStateSchema,
  createdAt: TimestampSchema,
  activatedAt: Type.Optional(TimestampSchema),
});

export type Deployment = typeof DeploymentSchema.static;
