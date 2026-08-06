import { Elysia } from 'elysia';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import { AppsAppIdArtifactsArtifactIdController } from '#routes/api/apps/[appId]/artifacts/[artifactId]/controller.ts';
import { AppsAppIdArtifactsController } from '#routes/api/apps/[appId]/artifacts/controller.ts';
import { AppsAppIdController } from '#routes/api/apps/[appId]/controller.ts';
import { AppsAppIdDeploymentsDeploymentIdController } from '#routes/api/apps/[appId]/deployments/[deploymentId]/controller.ts';
import { AppsAppIdDeploymentsDeploymentIdLogsController } from '#routes/api/apps/[appId]/deployments/[deploymentId]/logs/controller.ts';
import { AppsAppIdDeploymentsController } from '#routes/api/apps/[appId]/deployments/controller.ts';
import { AppsController } from '#routes/api/apps/controller.ts';
import { AuthController } from '#routes/api/auth/controller.ts';
import { HealthController } from '#routes/api/health/controller.ts';

export const ApiController = new Elysia({ prefix: RoutePrefix.Api })
  .use(AuthController)
  .use(HealthController)
  .use(AppsController)
  .use(AppsAppIdController)
  .use(AppsAppIdArtifactsController)
  .use(AppsAppIdArtifactsArtifactIdController)
  .use(AppsAppIdDeploymentsController)
  .use(AppsAppIdDeploymentsDeploymentIdController)
  .use(AppsAppIdDeploymentsDeploymentIdLogsController);
