import { Type } from '@sinclair/typebox';

export const BucketSetupResponseSchema = Type.Object({
  setupCode: Type.String(),
  expiresAt: Type.String(),
});
