import { type S3VolumeStorage, S3VolumeStorageSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import {
  openSecret,
  type SealedSecret,
  sealSecret,
  type TenantSecretsKey,
} from '#lib/tenant-secrets.ts';

export function sealVolumeStorage({
  key,
  storage,
}: {
  key: TenantSecretsKey;
  storage: S3VolumeStorage;
}): SealedSecret {
  if (!Value.Check(S3VolumeStorageSchema, storage)) {
    throw new Error('Invalid volume storage configuration.');
  }
  return sealSecret({
    key,
    plaintext: JSON.stringify(Value.Parse(S3VolumeStorageSchema, storage)),
  });
}

export function openVolumeStorage({
  key,
  sealed,
}: {
  key: TenantSecretsKey;
  sealed: SealedSecret;
}): S3VolumeStorage {
  let storage: unknown;
  try {
    storage = JSON.parse(openSecret({ key, sealed }));
  } catch {
    throw new Error('Stored volume storage configuration could not be opened.');
  }
  // TypeBox validation errors can include the rejected credentials. Check before parsing so
  // neither a malformed row nor a wrong key can put a secret in the polling error log.
  if (!Value.Check(S3VolumeStorageSchema, storage)) {
    throw new Error('Stored volume storage configuration is invalid.');
  }
  return Value.Parse(S3VolumeStorageSchema, storage);
}
