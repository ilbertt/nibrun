import { MAX_PAID_APPS_REQUEST, MIN_PAID_APPS_REQUEST } from '@repo/api-constants';
import { type Static, Type } from '@sinclair/typebox';

export const PaidRequestSchema = Type.Object(
  {
    requestType: Type.Literal('apps'),
    amount: Type.Integer({
      minimum: MIN_PAID_APPS_REQUEST,
      maximum: MAX_PAID_APPS_REQUEST,
      description: 'The total number of apps this account would like to have.',
    }),
  },
  { additionalProperties: false },
);

export type PaidRequest = Static<typeof PaidRequestSchema>;
