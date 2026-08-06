import { DirectoryListingSchema, GUEST_PATH_ROOT, OwnerIdSchema, Value } from '@repo/protocol';
import { Elysia, StatusMap } from 'elysia';
import { authPlugin } from '#lib/auth/plugin.ts';
import { ReadDirectoryQuerySchema } from '#routes/api/apps/[appId]/deployments/[deploymentId]/filesystem/model.ts';
import { DeploymentParamsSchema } from '#routes/api/apps/[appId]/deployments/model.ts';
import { FilesystemServicePlugin, loggerPlugin } from '#services/plugins.ts';

/**
 * Held open until a host answers, because a read is only performed when the host that holds the
 * volume next polls. The ceiling has to clear one of those polls plus the read itself, or this end
 * would abandon requests hosts are about to answer — and it stays well short of a log tail's,
 * since nothing arrives in the meantime to say the wait is still worth anything.
 */
const MAX_WAIT_SECONDS = 30;
const MS_PER_SECOND = 1000;
const MAX_WAIT_MS = MAX_WAIT_SECONDS * MS_PER_SECOND;

export const AppsAppIdDeploymentsDeploymentIdFilesystemController = new Elysia()
  .use(loggerPlugin('appsAppIdDeploymentsDeploymentIdFilesystemController'))
  .use(authPlugin)
  .use(FilesystemServicePlugin)
  .guard({ auth: true })
  .get(
    '/apps/:appId/deployments/:deploymentId/filesystem',
    async ({ filesystemService, params, query, user, request, status }) => {
      const listing = await filesystemService.readDirectory({
        appId: params.appId,
        deploymentId: params.deploymentId,
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        path: query.path ?? GUEST_PATH_ROOT,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(MAX_WAIT_MS)]),
      });
      return status(StatusMap.OK, listing);
    },
    {
      params: DeploymentParamsSchema,
      query: ReadDirectoryQuerySchema,
      response: { [StatusMap.OK]: DirectoryListingSchema },
    },
  );
