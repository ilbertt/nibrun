import { expect, test } from 'bun:test';
import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { Queries } from '#db/queries.gen.ts';
import { readSecretsKey, sealedFromStore, sealSecret } from '#lib/tenant-secrets.ts';
import { toVolumeStorage } from '#lib/volume-storage.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

const SECRETS_KEY_BYTES = 32;
const ROW: Queries['SelectDesiredVolumes'] = {
  app_id: Value.Parse(AppIdSchema, 'storage-app'),
  state: 'active',
  seed_digest: null,
  seed_size_bytes: null,
  seed_object_key: null,
  seed_original_file_name: null,
  volume_storage_endpoint: 'https://objects.example.test',
  volume_storage_bucket: 'customer-bucket',
  volume_storage_prefix: 'app/',
  volume_storage_region: null,
  volume_storage_auth_kind: 'access-key',
  volume_storage_access_key_id: 'access',
  volume_storage_secret_access_key: sealSecret({
    key: TEST_SECRETS_KEY,
    plaintext: 'must-not-be-logged',
  }),
  volume_storage_session_token: null,
  volume_storage_encryption_password: sealSecret({
    key: TEST_SECRETS_KEY,
    plaintext: 'filesystem-password',
  }),
};
const ERROR = 'Stored volume storage configuration is invalid or could not be opened.';

test('invalid stored fields never expose the decrypted credentials through validation errors', () => {
  expect(() =>
    toVolumeStorage({
      row: { ...ROW, volume_storage_endpoint: 'invalid' },
      secretsKey: TEST_SECRETS_KEY,
    }),
  ).toThrow(ERROR);
});

test('unreadable secret columns fail closed without falling back to shared storage', () => {
  const secretsKey = readSecretsKey(Buffer.alloc(SECRETS_KEY_BYTES).toString('base64'));
  expect(() => toVolumeStorage({ row: ROW, secretsKey })).toThrow(ERROR);
  expect(() =>
    toVolumeStorage({
      row: { ...ROW, volume_storage_secret_access_key: sealedFromStore('unsealed-secret') },
      secretsKey: TEST_SECRETS_KEY,
    }),
  ).toThrow(ERROR);
});
