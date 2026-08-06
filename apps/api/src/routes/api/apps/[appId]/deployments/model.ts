import { ArtifactIdSchema, DeploymentIdSchema, DeploymentSchema } from '@repo/protocol';
import { t } from 'elysia';
import { AppParamsSchema } from '#routes/api/apps/[appId]/model.ts';
import { PublicAppConfigSchema } from '#routes/api/apps/model.ts';

export const DeploymentParamsSchema = t.Composite([
  AppParamsSchema,
  t.Object({ deploymentId: t.String() }),
]);

/**
 * An artifact to run, or a release to go back to — never both and never neither. A union rather
 * than two optional fields, so a request naming both is a schema error rather than a rule the
 * handler has to remember to apply.
 */
export const CreateDeploymentBodySchema = t.Union([
  t.Object({ artifactId: ArtifactIdSchema }, { additionalProperties: false }),
  t.Object({ rollbackOf: DeploymentIdSchema }, { additionalProperties: false }),
]);

export const DeploymentResponseSchema = t.Composite([
  t.Omit(DeploymentSchema, ['config']),
  t.Object({ config: PublicAppConfigSchema }),
]);

export const ListDeploymentsResponseSchema = t.Object({
  deployments: t.Array(DeploymentResponseSchema),
});
