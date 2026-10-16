import {
  AppIdSchema,
  DeploymentIdSchema,
  DirectoryListingSchema,
  GUEST_PATH_ROOT,
} from '@repo/protocol';
import { publicSchema } from '@repo/typebox-extensions';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { AuthCaller } from '#lib/auth/caller.ts';
import { DIRECTORY_READ_TIMEOUT_MS } from '#lib/filesystem/timeouts.ts';
import { ReadDirectoryQuerySchema } from '#routes/api/apps/[appId]/deployments/[deploymentId]/filesystem/model.ts';
import { AuthPlugin, FilesystemServicePlugin, loggerPlugin } from '#services/plugins.ts';

export const AppsAppIdDeploymentsDeploymentIdFilesystemController = new Elysia()
  .use(loggerPlugin('appsAppIdDeploymentsDeploymentIdFilesystemController'))
  .use(AuthPlugin)
  .use(FilesystemServicePlugin)
  .guard({ auth: { policies: [AuthCaller.AnonymousAccount, AuthCaller.RegisteredAccount] } })
  .get(
    '/apps/:appId/deployments/:deploymentId/filesystem',
    async ({ filesystemService, params, query: queryInput, user, request, status }) => {
      const query = Value.Parse(ReadDirectoryQuerySchema, queryInput);
      const listing = await filesystemService.readDirectory({
        appId: Value.Parse(AppIdSchema, params.appId),
        deploymentId: Value.Parse(DeploymentIdSchema, params.deploymentId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        path: query.path ?? GUEST_PATH_ROOT,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(DIRECTORY_READ_TIMEOUT_MS)]),
      });
      return status(StatusMap.OK, listing);
    },
    {
      query: publicSchema(ReadDirectoryQuerySchema),
      response: { [StatusMap.OK]: publicSchema(DirectoryListingSchema) },
    },
  );
