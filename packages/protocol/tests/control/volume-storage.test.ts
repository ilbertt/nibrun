import { describe, expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { S3VolumeStorageSchema } from '#control/volume-storage.ts';
import { SECRET_ANNOTATION } from '#lib/secret.ts';
import { ProtocolValidationError, parseMessage } from '#lib/validate.ts';

function storage(overrides: Record<string, unknown> = {}) {
  return {
    kind: 's3',
    endpoint: 'https://objects.example.com',
    bucket: 'customer-bucket',
    prefix: 'nibrun/app-1',
    region: 'auto',
    accessKeyId: 'private-access-key',
    secretAccessKey: 'private-secret-key',
    encryptionPassword: 'private-filesystem-password',
    ...overrides,
  };
}

describe('external volume storage', () => {
  test('describes S3-compatible providers without requiring temporary credentials', () => {
    expect(Value.Check(S3VolumeStorageSchema, storage())).toBe(true);
    expect(Value.Check(S3VolumeStorageSchema, storage({ sessionToken: 'private-token' }))).toBe(
      true,
    );
  });

  test('allows providers without a region while rejecting an empty override', () => {
    expect(Value.Check(S3VolumeStorageSchema, storage({ region: undefined }))).toBe(true);
    expect(Value.Check(S3VolumeStorageSchema, storage({ region: '' }))).toBe(false);
  });

  test('requires explicit credentials and an encryption password', () => {
    for (const name of ['accessKeyId', 'secretAccessKey', 'encryptionPassword']) {
      expect(Value.Check(S3VolumeStorageSchema, storage({ [name]: undefined }))).toBe(false);
      expect(Value.Check(S3VolumeStorageSchema, storage({ [name]: '' }))).toBe(false);
    }
  });

  test('refuses cleartext endpoints and bucket names that change the storage URL', () => {
    expect(
      Value.Check(S3VolumeStorageSchema, storage({ endpoint: 'http://objects.example.com' })),
    ).toBe(false);
    expect(Value.Check(S3VolumeStorageSchema, storage({ bucket: 'bucket/prefix' }))).toBe(false);
    expect(Value.Check(S3VolumeStorageSchema, storage({ bucket: 'user@bucket' }))).toBe(false);
  });

  test('marks every credential and the filesystem password for schema-driven redaction', () => {
    for (const name of [
      'accessKeyId',
      'secretAccessKey',
      'sessionToken',
      'encryptionPassword',
    ] as const) {
      expect(S3VolumeStorageSchema.properties[name]?.[SECRET_ANNOTATION]).toBe(true);
    }
  });

  test('validation errors never include credentials', () => {
    const input = storage({ encryptionPassword: null });
    try {
      parseMessage({ schema: S3VolumeStorageSchema, value: input });
      throw new Error('expected invalid storage to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolValidationError);
      expect(JSON.stringify(error)).not.toInclude(input.accessKeyId);
      expect(JSON.stringify(error)).not.toInclude(input.secretAccessKey);
    }
  });
});
