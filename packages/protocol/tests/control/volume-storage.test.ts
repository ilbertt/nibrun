import { describe, expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { HostDesiredStateSchema } from '#control/desired-state.ts';
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

function desiredVolume(overrides: Record<string, unknown> = {}) {
  return {
    volumeId: 'vol-1',
    appId: 'app-1',
    sizeBytes: 4096,
    desiredState: 'present',
    ...overrides,
  };
}

function desiredState(volume: ReturnType<typeof desiredVolume>) {
  return {
    hostId: 'host-1',
    volumes: [volume],
    instances: [],
    checkpoints: [],
    exports: [],
  };
}

describe('optional desired volume storage', () => {
  test('existing desired state without storage is accepted without adding defaults', () => {
    const input = desiredState(desiredVolume());
    const parsed = parseMessage({ schema: HostDesiredStateSchema, value: input });
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(input));
    expect(parsed.volumes[0]).not.toHaveProperty('storage');
  });

  test.each([
    accessKeyAuth(),
    accessKeyAuth({ kind: 'session', sessionToken: 'private-session-token' }),
    { kind: 'anonymous' },
  ])('configured storage survives the desired-state wire format: %j', (auth) => {
    const configured = storage({ auth, region: undefined });
    const input = desiredState(desiredVolume({ storage: configured }));
    const parsed = parseMessage({
      schema: HostDesiredStateSchema,
      value: JSON.parse(JSON.stringify(input)),
    });
    expect(parsed.volumes[0]?.storage).toEqual(JSON.parse(JSON.stringify(configured)));
    expect(parsed.volumes[0]?.storage).not.toHaveProperty('region');
  });

  test.each([
    null,
    {},
    storage({ auth: { kind: 'session', sessionToken: 'private-token' } }),
    storage({ auth: accessKeyAuth({ secretAccessKey: undefined }) }),
  ])('a supplied storage field must be a complete configuration: %j', (configured) => {
    const input = desiredState(desiredVolume({ storage: configured }));
    expect(() => parseMessage({ schema: HostDesiredStateSchema, value: input })).toThrow(
      ProtocolValidationError,
    );
  });

  test('a nested storage validation failure never includes credentials or the encryption password', () => {
    const configured = storage({
      endpoint: 'http://objects.example.com',
      auth: accessKeyAuth({ kind: 'session', sessionToken: 'private-session-token' }),
    });
    const input = desiredState(desiredVolume({ storage: configured }));
    try {
      parseMessage({ schema: HostDesiredStateSchema, value: input });
      throw new Error('expected invalid desired storage to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolValidationError);
      const rendered = `${String(error)} ${JSON.stringify(error)}`;
      expect(rendered).not.toInclude(configured.auth.accessKeyId);
      expect(rendered).not.toInclude(configured.auth.secretAccessKey);
      expect(rendered).not.toInclude('private-session-token');
      expect(rendered).not.toInclude(configured.encryptionPassword);
    }
  });
});

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
