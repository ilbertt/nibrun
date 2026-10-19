import { Type } from '@sinclair/typebox';
import { PaidRequestSchema } from '#lib/api/paid-request.ts';

export const PaidRequestParamsSchema = Type.Pick(PaidRequestSchema, ['requestType']);
export const SavePaidRequestBodySchema = Type.Pick(PaidRequestSchema, ['amount']);
