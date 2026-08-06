import {
  AppIdSchema,
  DEFAULT_LOG_TIMERANGE,
  DeploymentIdSchema,
  OwnerIdSchema,
  Value,
} from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import {
  PollLogsQuerySchema,
  TenantLogPageSchema,
} from '#routes/api/apps/[appId]/deployments/[deploymentId]/logs/model.ts';
import { LogsServicePlugin, loggerPlugin } from '#services/plugins.ts';

/**
 * Held open until the deployment writes something, because a quiet app is the ordinary case and a
 * reader following one would otherwise spend its life asking and being told nothing.
 *
 * The ceiling is what keeps the wait a request rather than a stream: it answers, the reader asks
 * again with the cursor it was given, and the ownership check runs once more. It stays under the
 * idle timeout of anything that might sit between the two, since a proxy closing this first is
 * indistinguishable to the reader from a log that has stopped.
 */
const MAX_WAIT_SECONDS = 25;
const MS_PER_SECOND = 1000;
const MAX_WAIT_MS = MAX_WAIT_SECONDS * MS_PER_SECOND;

export const AppsAppIdDeploymentsDeploymentIdLogsController = new Elysia()
  .use(loggerPlugin('appsAppIdDeploymentsDeploymentIdLogsController'))
  .use(authPlugin)
  .use(LogsServicePlugin)
  .guard({ auth: true })
  .get(
    '/apps/:appId/deployments/:deploymentId/logs',
    async ({ logsService, params, query, user, request, status }) => {
      const page = await logsService.poll({
        appId: Value.Parse(AppIdSchema, params.appId),
        deploymentId: Value.Parse(DeploymentIdSchema, params.deploymentId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        since: query.since,
        timerange: query.timerange ?? DEFAULT_LOG_TIMERANGE,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(MAX_WAIT_MS)]),
      });
      return status(StatusMap.OK, page);
    },
    {
      query: PollLogsQuerySchema,
      response: { [StatusMap.OK]: TenantLogPageSchema },
    },
  );
