import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';

export const CUSTOM_BUCKET_REQUEST = {
  requestType: 'custom-bucket' as const,
  appId: Value.Parse(AppIdSchema, '019a0a00-0000-7000-8000-000000000001'),
};
