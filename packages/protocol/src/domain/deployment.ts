import { Type } from '@sinclair/typebox';
import { AppConfigSchema } from '#domain/app.ts';
import { AppIdSchema, ArtifactIdSchema, DeploymentIdSchema } from '#domain/identifiers.ts';
import { stringEnum } from '#lib/string-enum.ts';
import { StateMessageSchema, TimestampSchema } from '#lib/wire.ts';

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
  // The only account an owner gets of a release that did not come up. The database has kept it
  // since deployments existed; until now nothing read it back out.
  message: Type.Optional(StateMessageSchema),
  // Present when this deployment was made by going back to an older one, naming the one it
  // replays. A rollback is a new deployment rather than an old one revived, so this is what
  // says a release happened twice.
  rollbackOf: Type.Optional(DeploymentIdSchema),
});

export type Deployment = typeof DeploymentSchema.static;
