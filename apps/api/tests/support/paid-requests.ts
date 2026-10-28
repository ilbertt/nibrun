import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';

export const CUSTOM_BUCKET_REQUEST = {
  requestType: 'custom-bucket' as const,
  appId: Value.Parse(AppIdSchema, '019a0a00-0000-7000-8000-000000000001'),
};

export const ALWAYS_ON_REQUEST = {
  requestType: 'always-on' as const,
  appId: CUSTOM_BUCKET_REQUEST.appId,
};

export const RESOURCES_REQUEST = {
  requestType: 'resources' as const,
  appId: CUSTOM_BUCKET_REQUEST.appId,
};

export const APP_PAID_REQUESTS = [CUSTOM_BUCKET_REQUEST, ALWAYS_ON_REQUEST, RESOURCES_REQUEST];
