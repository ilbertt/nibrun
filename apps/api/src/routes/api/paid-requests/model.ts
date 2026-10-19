import { Type } from '@sinclair/typebox';
import { PaidRequestSchema } from '#lib/api/paid-request.ts';

export const ListPaidRequestsResponseSchema = Type.Object({
  requests: Type.Array(PaidRequestSchema),
});
