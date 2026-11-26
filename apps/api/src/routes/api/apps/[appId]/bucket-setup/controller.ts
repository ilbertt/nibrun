import { AppIdSchema } from '@repo/protocol';
import { publicSchema } from '@repo/typebox-extensions';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap } from 'elysia';
import { CustomerVolumeInputSchema } from '#lib/api/customer-volume.ts';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { AuthCaller } from '#lib/auth/caller.ts';
import { BucketSetupResponseSchema } from '#routes/api/apps/[appId]/bucket-setup/model.ts';
import { AppsServicePlugin, AuthPlugin } from '#services/plugins.ts';

export const AppsAppIdBucketSetupController = new Elysia()
  .use(AuthPlugin)
  .use(AppsServicePlugin)
  .post(
    '/apps/:appId/bucket-setup',
    async ({ appsService, params, user, body, set }) => {
      set.headers['cache-control'] = 'no-store';
      return await appsService.prepareBucketSetup({
        ownerId: Value.Parse(OwnerIdSchema, user.id),
        appId: Value.Parse(AppIdSchema, params.appId),
        storage: Value.Parse(CustomerVolumeInputSchema, body),
      });
    },
    {
      auth: { policies: [AuthCaller.RegisteredAccount] },
      body: publicSchema(CustomerVolumeInputSchema),
      response: { [StatusMap.OK]: publicSchema(BucketSetupResponseSchema) },
    },
  );
