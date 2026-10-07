import { Elysia } from 'elysia';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import { SqliteClientCorsPlugin } from '#lib/sqlite/cors.ts';
import { AppsAppIdArtifactsArtifactIdController } from '#routes/api/apps/[appId]/artifacts/[artifactId]/controller.ts';
import { AppsAppIdArtifactsController } from '#routes/api/apps/[appId]/artifacts/controller.ts';
import { AppsAppIdController } from '#routes/api/apps/[appId]/controller.ts';
import { AppsAppIdDeploymentsDeploymentIdController } from '#routes/api/apps/[appId]/deployments/[deploymentId]/controller.ts';
import { AppsAppIdDeploymentsDeploymentIdCronsController } from '#routes/api/apps/[appId]/deployments/[deploymentId]/crons/controller.ts';
import { AppsAppIdDeploymentsDeploymentIdFilesystemController } from '#routes/api/apps/[appId]/deployments/[deploymentId]/filesystem/controller.ts';
import { AppsAppIdDeploymentsDeploymentIdLogsController } from '#routes/api/apps/[appId]/deployments/[deploymentId]/logs/controller.ts';
import { AppsAppIdDeploymentsController } from '#routes/api/apps/[appId]/deployments/controller.ts';
import { AppsAppIdExportsExportIdController } from '#routes/api/apps/[appId]/exports/[exportId]/controller.ts';
import { AppsAppIdExportsController } from '#routes/api/apps/[appId]/exports/controller.ts';
import { AppsAppIdHostnamesController } from '#routes/api/apps/[appId]/hostnames/controller.ts';
import { AppsAppIdHostnamesDnsController } from '#routes/api/apps/[appId]/hostnames/dns/controller.ts';
import { AppsAppIdImportsImportIdController } from '#routes/api/apps/[appId]/imports/[importId]/controller.ts';
import { AppsAppIdImportsController } from '#routes/api/apps/[appId]/imports/controller.ts';
import { AppsAppIdSqliteConnectionsConnectionIdController } from '#routes/api/apps/[appId]/sqlite/connections/[connectionId]/controller.ts';
import { AppsAppIdSqliteConnectionsController } from '#routes/api/apps/[appId]/sqlite/connections/controller.ts';
import { AppsAppIdStateController } from '#routes/api/apps/[appId]/state/controller.ts';
import { AppsController } from '#routes/api/apps/controller.ts';
import { AuthController } from '#routes/api/auth/controller.ts';
import { HealthController } from '#routes/api/health/controller.ts';
import { SqliteConnectionsConnectionIdV2Controller } from '#routes/api/sqlite/connections/[connectionId]/v2/controller.ts';
import { SqliteConnectionsConnectionIdV2PipelineController } from '#routes/api/sqlite/connections/[connectionId]/v2/pipeline/controller.ts';

export const ApiController = new Elysia({ prefix: RoutePrefix.Api })
  .use(SqliteClientCorsPlugin)
  .use(AuthController)
  .use(HealthController)
  .use(AppsController)
  .use(AppsAppIdController)
  .use(AppsAppIdArtifactsController)
  .use(AppsAppIdArtifactsArtifactIdController)
  .use(AppsAppIdDeploymentsController)
  .use(AppsAppIdDeploymentsDeploymentIdController)
  .use(AppsAppIdDeploymentsDeploymentIdCronsController)
  .use(AppsAppIdDeploymentsDeploymentIdFilesystemController)
  .use(AppsAppIdDeploymentsDeploymentIdLogsController)
  .use(AppsAppIdExportsController)
  .use(AppsAppIdExportsExportIdController)
  .use(AppsAppIdImportsController)
  .use(AppsAppIdImportsImportIdController)
  .use(AppsAppIdHostnamesController)
  .use(AppsAppIdHostnamesDnsController)
  .use(AppsAppIdStateController)
  .use(AppsAppIdSqliteConnectionsController)
  .use(AppsAppIdSqliteConnectionsConnectionIdController)
  .use(SqliteConnectionsConnectionIdV2Controller)
  .use(SqliteConnectionsConnectionIdV2PipelineController);
