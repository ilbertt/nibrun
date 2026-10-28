import {
  MAX_PAID_APPS_REQUEST,
  MAX_PAID_RESOURCE_AMOUNT,
  MIN_PAID_APPS_REQUEST,
} from '@repo/api-constants';
import { AppIdSchema } from '@repo/protocol';
import { type Static, Type } from '@sinclair/typebox';

const RequestedResourceAmountSchema = Type.Integer({
  minimum: 1,
  maximum: MAX_PAID_RESOURCE_AMOUNT,
});

export const PaidRequestSchema = Type.Union([
  Type.Object(
    {
      requestType: Type.Literal('apps'),
      requestedAppsAmount: Type.Integer({
        minimum: MIN_PAID_APPS_REQUEST,
        maximum: MAX_PAID_APPS_REQUEST,
        description: 'The total number of apps this account would like to have.',
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { requestType: Type.Literal('custom-bucket'), appId: AppIdSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { requestType: Type.Literal('always-on'), appId: AppIdSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      requestType: Type.Literal('resources'),
      appId: AppIdSchema,
      requestedVcpuCount: RequestedResourceAmountSchema,
      requestedMemoryMib: RequestedResourceAmountSchema,
      requestedVolumeGib: RequestedResourceAmountSchema,
    },
    { additionalProperties: false },
  ),
]);

export type PaidRequest = Static<typeof PaidRequestSchema>;
