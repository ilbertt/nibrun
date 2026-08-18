import { readSecretsKey, type TenantSecretsKey } from '#lib/tenant-secrets.ts';

const KEY_BYTES = 32;

/** Fixed rather than random, so a failure reproduces from the same ciphertexts it was seen with. */
export const TEST_SECRETS_KEY: TenantSecretsKey = readSecretsKey(
  Buffer.from('k'.repeat(KEY_BYTES)).toString('base64'),
);

export const TEST_SECRETS_KEY_BASE64 = Buffer.from('k'.repeat(KEY_BYTES)).toString('base64');
