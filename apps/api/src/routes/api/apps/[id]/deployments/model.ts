import {
  ArtifactIdSchema,
  DeploymentIdSchema,
  DeploymentSchema,
  type DeploymentState,
} from '@repo/protocol';
import { t } from 'elysia';
import { AppParamsSchema } from '#routes/api/apps/[id]/model.ts';
import { PublicAppConfigSchema } from '#routes/api/apps/model.ts';

const ACTIVE = 'active' satisfies DeploymentState;

export const DeploymentParamsSchema = t.Composite([
  AppParamsSchema,
  t.Object({ deploymentId: DeploymentIdSchema }),
]);

export const CreateDeploymentBodySchema = t.Object(
  { artifactId: ArtifactIdSchema },
  { additionalProperties: false },
);

// Activating is the only transition an owner asks for, and a rollback is activating an older
// row. The remaining states are the api's own as the deployment runs.
export const UpdateDeploymentBodySchema = t.Object(
  { state: t.Literal(ACTIVE) },
  { additionalProperties: false },
);

export const DeploymentResponseSchema = t.Composite([
  t.Omit(DeploymentSchema, ['config']),
  t.Object({ config: PublicAppConfigSchema }),
]);

export const ListDeploymentsResponseSchema = t.Object({
  deployments: t.Array(DeploymentResponseSchema),
});
