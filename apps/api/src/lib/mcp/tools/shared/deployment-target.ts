import { AppIdSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { CreateAppRequestSchema } from '#routes/api/apps/model.ts';
import type { AppsService } from '#services/apps.service.ts';

export const DeploymentTargetSchema = Type.Object(
  {
    appId: Type.Optional(AppIdSchema),
    name: Type.Optional(CreateAppRequestSchema.properties.name),
    config: CreateAppRequestSchema.properties.config,
  },
  {
    additionalProperties: false,
    allOf: [
      { oneOf: [{ required: ['appId'] }, { required: ['name'] }] },
      { not: { required: ['appId', 'config'] } },
    ],
  },
);

export function appForDeployment({
  appsService,
  ownerId,
  target: { appId, name, config },
}: {
  appsService: AppsService;
  ownerId: OwnerId;
  target: typeof DeploymentTargetSchema.static;
}): ReturnType<AppsService['get']> {
  return appId === undefined
    ? appsService.create({
        ownerId,
        isAnonymous: false,
        name: Value.Parse(CreateAppRequestSchema.properties.name, name),
        config,
      })
    : appsService.get({ appId, ownerId });
}
