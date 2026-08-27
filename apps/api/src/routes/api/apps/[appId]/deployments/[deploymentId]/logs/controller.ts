import {
  AppIdSchema,
  DEFAULT_LOG_TIMERANGE,
  DeploymentIdSchema,
  OwnerIdSchema,
  type TenantLogRecord,
  Value,
} from '@repo/protocol';
import { Elysia, sse } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import { StreamLogsQuerySchema } from '#routes/api/apps/[appId]/deployments/[deploymentId]/logs/model.ts';
import { LogsServicePlugin, loggerPlugin } from '#services/plugins.ts';

/**
 * A stream is closed after this long and the client reconnects, which is what keeps an
 * authorization decision made at the start of a stream from outliving the stream.
 */
const MAX_STREAM_MINUTES = 15;
const MS_PER_MINUTE = 60_000;
const MAX_STREAM_MS = MAX_STREAM_MINUTES * MS_PER_MINUTE;

export const AppsAppIdDeploymentsDeploymentIdLogsController = new Elysia()
  .use(loggerPlugin('appsAppIdDeploymentsDeploymentIdLogsController'))
  .use(authPlugin)
  .use(LogsServicePlugin)
  .guard({ auth: true })
  .get(
    '/apps/:appId/deployments/:deploymentId/logs',
    // Not a generator itself: the ownership check has to answer before anything is streamed, and
    // a generator body would only run once the response had already been committed as a stream.
    async ({ logsService, params, query, user, request }) => {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(MAX_STREAM_MS)]);
      const records = await logsService.openStream({
        appId: Value.Parse(AppIdSchema, params.appId),
        deploymentId: Value.Parse(DeploymentIdSchema, params.deploymentId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        timerange: query.timerange ?? DEFAULT_LOG_TIMERANGE,
        follow: query.follow ?? true,
        signal,
      });
      return events({ records, signal });
    },
    {
      query: StreamLogsQuerySchema,
    },
  );

/**
 * A closed stream is the ordinary ending — the cap above reaches it on every long-lived stream,
 * and so does a reader navigating away — so an abort finishes the response rather than failing it.
 *
 * The signal decides that, not the error: a cancelled request and an expired cap raise different
 * exceptions (`AbortError` and `TimeoutError`), and the cap is the one that fires every time.
 */
async function* events({
  records,
  signal,
}: {
  records: AsyncIterable<TenantLogRecord>;
  signal: AbortSignal;
}) {
  try {
    for await (const record of records) {
      yield sse({ event: 'log', data: record });
    }
  } catch (error) {
    if (!signal.aborted) {
      throw error;
    }
  }
}
