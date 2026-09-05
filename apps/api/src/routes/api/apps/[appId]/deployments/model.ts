import {
  ArtifactIdSchema,
  DeploymentIdSchema,
  DeploymentSchema,
  ImportIdSchema,
} from '@repo/protocol';
import { t } from 'elysia';
import { PublicAppConfigSchema } from '#routes/api/apps/model.ts';

/**
 * An artifact to run, or a release to go back to — never both and never neither. A union rather
 * than two optional fields, so a request naming both is a schema error rather than a rule the
 * handler has to remember to apply.
 *
 * `resetDataFrom` rides on the first of the two and not the second: a rollback replays a release
 * exactly as it ran, and creating the app's filesystem from an archive is not something that
 * happened then. It is optional because it happens once in an app's life and never again — the
 * moment a host says the filesystem exists, naming one is refused.
 */
export const CreateDeploymentBodySchema = t.Union([
  t.Object(
    { artifactId: ArtifactIdSchema, resetDataFrom: t.Optional(ImportIdSchema) },
    { additionalProperties: false },
  ),
  t.Object({ rollbackOf: DeploymentIdSchema }, { additionalProperties: false }),
]);

export const DeploymentResponseSchema = t.Composite([
  t.Omit(DeploymentSchema, ['config']),
  t.Object({ config: PublicAppConfigSchema }),
]);

export const ListDeploymentsResponseSchema = t.Object({
  deployments: t.Array(DeploymentResponseSchema),
});
