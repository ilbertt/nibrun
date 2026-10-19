import { APP_QUOTA_EXCEEDED_CODE } from '@repo/api-constants';
import { type Static, Type } from '@sinclair/typebox';

export const AppQuotaExceededResponseSchema = Type.Object({
  error: Type.String(),
  code: Type.Literal(APP_QUOTA_EXCEEDED_CODE),
  appsAllowed: Type.Integer({ minimum: 0 }),
});

export type AppQuotaExceededResponse = Static<typeof AppQuotaExceededResponseSchema>;
