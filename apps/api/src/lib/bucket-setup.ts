import { createHmac } from 'node:crypto';
import type { AppId } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { type CustomerVolumeInput, CustomerVolumeInputSchema } from '#lib/api/customer-volume.ts';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { BadRequestError } from '#lib/errors.ts';
import {
  openSecret,
  readSecretsKey,
  sealedFromStore,
  sealSecret,
  type TenantSecretsKey,
} from '#lib/tenant-secrets.ts';
import { validatedVolumeStorage } from '#lib/volume-storage.ts';

const SETUP_LIFETIME_MINUTES = 10;
const MS_PER_MINUTE = 60_000;
const PayloadSchema = Type.Object({
  storage: CustomerVolumeInputSchema,
  expiresAt: Type.Integer(),
});
type Scope = { appId: AppId; ownerId: OwnerId; key: TenantSecretsKey };

function setupKey({ appId, ownerId, key }: Scope): TenantSecretsKey {
  return readSecretsKey(
    createHmac('sha256', key)
      .update(JSON.stringify(['mcp-bucket-setup-v1', ownerId, appId]))
      .digest('base64'),
  );
}

export function issueBucketSetup({ storage, ...scope }: Scope & { storage: CustomerVolumeInput }) {
  const expiresAt = Date.now() + SETUP_LIFETIME_MINUTES * MS_PER_MINUTE;
  const setupCode = sealSecret({
    key: setupKey(scope),
    plaintext: JSON.stringify({ storage: validatedVolumeStorage(storage), expiresAt }),
  });
  return { setupCode, expiresAt: new Date(expiresAt).toISOString() };
}

export class InvalidBucketSetupError extends BadRequestError {
  constructor() {
    super(
      'This bucket setup code is invalid or expired. Open the private setup form for this app to get a new code.',
    );
  }
}

export function readBucketSetup({
  setupCode,
  ...scope
}: Scope & { setupCode: string }): CustomerVolumeInput {
  try {
    const payload: unknown = JSON.parse(
      openSecret({ key: setupKey(scope), sealed: sealedFromStore(setupCode) }),
    );
    if (Value.Check(PayloadSchema, payload) && payload.expiresAt > Date.now()) {
      return payload.storage;
    }
  } catch {
    // Decryption and parsing failures must never echo any part of the payload.
  }
  throw new InvalidBucketSetupError();
}
