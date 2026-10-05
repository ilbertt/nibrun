import { AppIdSchema, CronListingSchema, DeploymentIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { publicSchema } from '#lib/api/public-schema.ts';
import { Identity } from '#lib/auth/plugin.ts';
import { AuthPlugin, CronsServicePlugin, loggerPlugin } from '#services/plugins.ts';

const MAX_WAIT_MS = 30_000;

export const AppsAppIdDeploymentsDeploymentIdCronsController = new Elysia()
  .use(loggerPlugin('appsAppIdDeploymentsDeploymentIdCronsController'))
  .use(AuthPlugin)
  .use(CronsServicePlugin)
  .guard({ auth: Identity.Optional })
  .get(
    '/apps/:appId/deployments/:deploymentId/crons',
    async ({ cronsService, params, user, request, status }) => {
      const listing = await cronsService.list({
        appId: Value.Parse(AppIdSchema, params.appId),
        deploymentId: Value.Parse(DeploymentIdSchema, params.deploymentId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(MAX_WAIT_MS)]),
      });
      return status(StatusMap.OK, listing);
    },
    { response: { [StatusMap.OK]: publicSchema(CronListingSchema) } },
  );
