import { expect, spyOn, test } from 'bun:test';
import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { CustomerVolumeInputSchema } from '#lib/api/customer-volume.ts';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { InvalidBucketSetupError, issueBucketSetup, readBucketSetup } from '#lib/bucket-setup.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

const scope = {
  appId: Value.Parse(AppIdSchema, 'app-1'),
  ownerId: Value.Parse(OwnerIdSchema, 'owner'),
  key: TEST_SECRETS_KEY,
};
const storage = Value.Parse(CustomerVolumeInputSchema, {
  endpoint: 'https://objects.example.com',
  bucket: 'customer-bucket',
  auth: {
    kind: 'session',
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
    sessionToken: 'session-token',
  },
  encryptionPassword: 'encryption-password',
});

test('the private setup code opens only for its owner and app before expiry', () => {
  const { setupCode, expiresAt } = issueBucketSetup({ ...scope, storage });
  expect(setupCode).not.toContain(storage.encryptionPassword);
  expect(readBucketSetup({ ...scope, setupCode })).toEqual(storage);
  for (const changed of [
    { ownerId: Value.Parse(OwnerIdSchema, 'other-owner') },
    { appId: Value.Parse(AppIdSchema, 'other-app') },
    { setupCode: 'unreadable' },
  ]) {
    expect(() => readBucketSetup({ ...scope, setupCode, ...changed })).toThrow(
      InvalidBucketSetupError,
    );
  }
  const clock = spyOn(Date, 'now').mockReturnValue(Date.parse(expiresAt));
  try {
    expect(() => readBucketSetup({ ...scope, setupCode })).toThrow(InvalidBucketSetupError);
  } finally {
    clock.mockRestore();
  }
});
