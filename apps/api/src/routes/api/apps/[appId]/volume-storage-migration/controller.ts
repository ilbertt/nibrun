import { AppIdSchema } from '@repo/protocol';
import { publicSchema } from '@repo/typebox-extensions';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap, t } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { AuthCaller } from '#lib/auth/caller.ts';
import { CancelVolumeStorageMigrationQuerySchema } from '#routes/api/apps/[appId]/volume-storage-migration/model.ts';
import { AuthPlugin, VolumeStorageMigrationsServicePlugin } from '#services/plugins.ts';

export const AppsAppIdVolumeStorageMigrationController = new Elysia()
  .use(AuthPlugin)
  .use(VolumeStorageMigrationsServicePlugin)
  .guard({ auth: { policies: [AuthCaller.RegisteredAccount] } })
  .delete(
    '/apps/:appId/volume-storage-migration',
    async function cancelMigration({
      volumeStorageMigrationsService,
      params,
      query,
      user,
      status,
    }) {
      const { configId } = Value.Parse(CancelVolumeStorageMigrationQuerySchema, query);
      await volumeStorageMigrationsService.cancel({
        appId: Value.Parse(AppIdSchema, params.appId),
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        configId,
      });
      return status(StatusMap['No Content'], undefined);
    },
    {
      query: publicSchema(CancelVolumeStorageMigrationQuerySchema),
      response: { [StatusMap['No Content']]: t.Void() },
    },
  );
