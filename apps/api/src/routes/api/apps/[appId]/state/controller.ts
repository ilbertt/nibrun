import { AppIdSchema } from '@repo/protocol';
import { publicSchema } from '@repo/typebox-extensions';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { AuthCaller } from '#lib/auth/caller.ts';
import { BadRequestError } from '#lib/errors.ts';
import { AppStateRequestSchema } from '#routes/api/apps/[appId]/state/model.ts';
import { AppResponseSchema } from '#routes/api/apps/model.ts';
import {
  AppsServicePlugin,
  AuthPlugin,
  loggerPlugin,
  VolumeStorageMigrationsServicePlugin,
} from '#services/plugins.ts';

export const AppsAppIdStateController = new Elysia()
  .use(loggerPlugin('appsAppIdStateController'))
  .use(AuthPlugin)
  .use(AppsServicePlugin)
  .use(VolumeStorageMigrationsServicePlugin)
  .guard({ auth: { policies: [AuthCaller.RegisteredAccount] } })
  // Idempotent on purpose: suspending an app twice is suspending it, so a retry after a lost
  // response is the same request rather than a second one.
  .put(
    '/apps/:appId/state',
    async function setAppState({
      appsService,
      volumeStorageMigrationsService,
      params,
      body: bodyInput,
      user,
      status,
    }) {
      const body = Value.Parse(AppStateRequestSchema, bodyInput);
      const ownedApp = {
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
      };
      if ('volumeStorageMigration' in body) {
        if (body.volumeStorageMigration.state !== 'cancelled') {
          throw new BadRequestError('Unsupported storage migration state.');
        }
        await volumeStorageMigrationsService.cancel({
          ...ownedApp,
          configId: body.volumeStorageMigration.configId,
        });
        return status(StatusMap.OK, await appsService.get(ownedApp));
      }
      const app = await appsService.setState({
        ...ownedApp,
        state: body.state,
      });
      return status(StatusMap.OK, app);
    },
    {
      body: publicSchema(AppStateRequestSchema),
      response: { [StatusMap.OK]: publicSchema(AppResponseSchema) },
    },
  );
