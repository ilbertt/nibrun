import { expect, test } from 'bun:test';
import { type S3VolumeStorage, S3VolumeStorageSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { readSecretsKey, sealSecret } from '#lib/tenant-secrets.ts';
import { openVolumeStorage, sealVolumeStorage } from '#lib/volume-storage.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

const SECRETS_KEY_BYTES = 32;

const STORAGE = Value.Parse(S3VolumeStorageSchema, {
  endpoint: 'https://objects.example.test',
  bucket: 'customer-bucket',
  prefix: 'app/',
  region: 'custom',
  auth: {
    kind: 'session',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
    sessionToken: 'token',
  },
  encryptionPassword: 'filesystem-password',
});

test('storage uses the existing randomized secret envelope and retains an explicit region', () => {
  const sealed = sealVolumeStorage({ key: TEST_SECRETS_KEY, storage: STORAGE });
  expect(sealed).not.toBe(sealVolumeStorage({ key: TEST_SECRETS_KEY, storage: STORAGE }));
  expect(openVolumeStorage({ key: TEST_SECRETS_KEY, sealed })).toEqual(STORAGE);
});

test('invalid stored values fail closed without exposing rejected credentials', () => {
  for (const plaintext of [
    'not-json-secret',
    JSON.stringify({ ...STORAGE, auth: { kind: 'session', sessionToken: 'must-not-be-logged' } }),
  ]) {
    const sealed = sealSecret({ key: TEST_SECRETS_KEY, plaintext });
    expect(() => openVolumeStorage({ key: TEST_SECRETS_KEY, sealed })).toThrow(
      /^Stored volume storage configuration (could not be opened|is invalid)\.$/,
    );
  }
  const key = readSecretsKey(Buffer.alloc(SECRETS_KEY_BYTES).toString('base64'));
  const sealed = sealVolumeStorage({ key: TEST_SECRETS_KEY, storage: STORAGE });
  expect(() => openVolumeStorage({ key, sealed })).toThrow(
    'Stored volume storage configuration could not be opened.',
  );
});

test('incomplete auth cannot be sealed for storage', () => {
  const storage = {
    ...STORAGE,
    auth: { kind: 'session', sessionToken: 'must-not-be-logged' },
  } as S3VolumeStorage;
  expect(() => sealVolumeStorage({ key: TEST_SECRETS_KEY, storage })).toThrow(
    'Invalid volume storage configuration.',
  );
});
