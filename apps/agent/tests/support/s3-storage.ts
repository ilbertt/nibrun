import { type S3VolumeStorage, S3VolumeStorageSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';

export function s3Storage(overrides: Record<string, unknown> = {}): S3VolumeStorage {
  return Value.Parse(S3VolumeStorageSchema, {
    endpoint: 'https://objects.example.com',
    bucket: 'customer-data',
    prefix: 'apps/app-1',
    region: 'eu-central-1',
    auth: {
      kind: 'access-key',
      accessKeyId: 'customer-access-key',
      secretAccessKey: 'customer-secret-key',
    },
    encryptionPassword: 'customer-filesystem-password',
    ...overrides,
  });
}
