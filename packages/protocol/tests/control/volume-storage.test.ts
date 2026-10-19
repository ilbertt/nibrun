import { describe, expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { S3VolumeAuthSchema, S3VolumeStorageSchema } from '#control/volume-storage.ts';
import { SECRET_ANNOTATION } from '#lib/secret.ts';
import { ProtocolValidationError, parseMessage } from '#lib/validate.ts';

function accessKeyAuth(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'access-key',
    accessKeyId: 'private-access-key',
    secretAccessKey: 'private-secret-key',
    ...overrides,
  };
}

function storage(overrides: Record<string, unknown> = {}) {
  return {
    endpoint: 'https://objects.example.com',
    bucket: 'customer-bucket',
    prefix: 'nibrun/app-1',
    region: 'auto',
    auth: accessKeyAuth(),
    encryptionPassword: 'private-filesystem-password',
    ...overrides,
  };
}

describe('external volume storage', () => {
  test('supports explicit key-pair, session and anonymous authentication', () => {
    expect(Value.Check(S3VolumeStorageSchema, storage())).toBe(true);
    expect(
      Value.Check(
        S3VolumeStorageSchema,
        storage({ auth: accessKeyAuth({ kind: 'session', sessionToken: 'private-token' }) }),
      ),
    ).toBe(true);
    expect(Value.Check(S3VolumeStorageSchema, storage({ auth: { kind: 'anonymous' } }))).toBe(true);
  });

  test('allows providers without a region while rejecting an empty override', () => {
    expect(Value.Check(S3VolumeStorageSchema, storage({ region: undefined }))).toBe(true);
    expect(Value.Check(S3VolumeStorageSchema, storage({ region: '' }))).toBe(false);
  });

  test('requires both keys for signed authentication and all three session credentials', () => {
    for (const auth of [
      accessKeyAuth(),
      accessKeyAuth({ kind: 'session', sessionToken: 'token' }),
    ]) {
      for (const name of ['accessKeyId', 'secretAccessKey']) {
        expect(Value.Check(S3VolumeAuthSchema, { ...auth, [name]: undefined })).toBe(false);
        expect(Value.Check(S3VolumeAuthSchema, { ...auth, [name]: '' })).toBe(false);
      }
    }
    expect(Value.Check(S3VolumeAuthSchema, accessKeyAuth({ kind: 'session' }))).toBe(false);
    expect(Value.Check(S3VolumeAuthSchema, { kind: 'session', sessionToken: 'token' })).toBe(false);
  });

  test('rejects absent, unknown and mixed authentication modes', () => {
    expect(Value.Check(S3VolumeStorageSchema, storage({ auth: undefined }))).toBe(false);
    expect(Value.Check(S3VolumeAuthSchema, { kind: 'unknown' })).toBe(false);
    expect(Value.Check(S3VolumeAuthSchema, accessKeyAuth({ sessionToken: 'token' }))).toBe(false);
    expect(Value.Check(S3VolumeAuthSchema, accessKeyAuth({ kind: 'anonymous' }))).toBe(false);
  });

  test('requires an encryption password with every authentication mode', () => {
    expect(Value.Check(S3VolumeStorageSchema, storage({ encryptionPassword: undefined }))).toBe(
      false,
    );
    expect(Value.Check(S3VolumeStorageSchema, storage({ encryptionPassword: '' }))).toBe(false);
  });

  test('refuses cleartext endpoints and bucket names that change the storage URL', () => {
    expect(
      Value.Check(S3VolumeStorageSchema, storage({ endpoint: 'http://objects.example.com' })),
    ).toBe(false);
    expect(Value.Check(S3VolumeStorageSchema, storage({ bucket: 'bucket/prefix' }))).toBe(false);
    expect(Value.Check(S3VolumeStorageSchema, storage({ bucket: 'user@bucket' }))).toBe(false);
  });

  test('marks every credential and the filesystem password for schema-driven redaction', () => {
    expect(S3VolumeStorageSchema.properties.auth[SECRET_ANNOTATION]).toBe(true);
    expect(S3VolumeStorageSchema.properties.encryptionPassword[SECRET_ANNOTATION]).toBe(true);
    for (const variant of S3VolumeAuthSchema.anyOf) {
      for (const [name, property] of Object.entries(variant.properties)) {
        if (name !== 'kind') {
          expect(property[SECRET_ANNOTATION]).toBe(true);
        }
      }
    }
  });

  test('validation errors never include credentials', () => {
    const input = storage({ encryptionPassword: null });
    try {
      parseMessage({ schema: S3VolumeStorageSchema, value: input });
      throw new Error('expected invalid storage to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolValidationError);
      expect(JSON.stringify(error)).not.toInclude(input.auth.accessKeyId);
      expect(JSON.stringify(error)).not.toInclude(input.auth.secretAccessKey);
    }
  });
});
