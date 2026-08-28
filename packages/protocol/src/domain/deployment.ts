import { Type } from '@sinclair/typebox';
import { AppConfigSchema } from '#domain/app.ts';
import { AppIdSchema, ArtifactIdSchema, DeploymentIdSchema } from '#domain/identifiers.ts';
import { stringEnum } from '#lib/string-enum.ts';
import { StateMessageSchema, TimestampSchema } from '#lib/wire.ts';

// `stopped` is the one an owner puts a release into and takes it back out of: a suspended app's
// microVM is down and the release is still the app's current one, which is a different thing from
// a release that failed and from one a newer deployment replaced. Non-terminal, so a host is
// still told about it — being told is what lets the app be resumed onto the same release.
export const DEPLOYMENT_STATES = [
  'pending',
  'starting',
  'running',
  'stopped',
  'superseded',
  'failed',
] as const;

export const DeploymentStateSchema = stringEnum(DEPLOYMENT_STATES);

export type DeploymentState = typeof DeploymentStateSchema.static;

export const DeploymentSchema = Type.Object({
  id: DeploymentIdSchema,
  appId: AppIdSchema,
  artifactId: ArtifactIdSchema,
  config: AppConfigSchema,
  state: DeploymentStateSchema,
  createdAt: TimestampSchema,
  // What a host observed of the microVM this release is, as against when the release was asked
  // for. Each is absent until the moment it names has happened: a release still being staged has
  // no start, and one that never answered a probe has never been healthy.
  startedAt: Type.Optional(TimestampSchema),
  activatedAt: Type.Optional(TimestampSchema),
  lastHealthyAt: Type.Optional(TimestampSchema),
  restartCount: Type.Integer({ minimum: 0 }),
  // The only account an owner gets of a release that did not come up. The database has kept all
  // of this since deployments existed; until now nothing read it back out.
  message: Type.Optional(StateMessageSchema),
  // Present when this deployment was made by going back to an older one, naming the one it
  // replays. A rollback is a new deployment rather than an old one revived, so this is what
  // says a release happened twice.
  rollbackOf: Type.Optional(DeploymentIdSchema),
});

export type Deployment = typeof DeploymentSchema.static;
