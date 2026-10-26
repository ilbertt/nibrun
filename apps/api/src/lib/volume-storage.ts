import { type AppId, type S3VolumeStorage, S3VolumeStorageSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { Queries } from '#db/queries.gen.ts';
import {
  type CreateVolumeStorage,
  type VolumeStorageMetadata,
  VolumeStorageMetadataSchema,
} from '#lib/api/volume-storage.ts';
import { openSecret, sealSecret, type TenantSecretsKey } from '#lib/tenant-secrets.ts';

export type SealedVolumeStorage = Pick<
  Queries['SelectCurrentAppConfig'],
  | 'volume_storage_endpoint'
  | 'volume_storage_bucket'
  | 'volume_storage_region'
  | 'volume_storage_auth_kind'
  | 'volume_storage_access_key_id'
  | 'volume_storage_secret_access_key'
  | 'volume_storage_session_token'
  | 'volume_storage_encryption_password'
>;

export function sealVolumeStorage({
  storage,
  key,
}: {
  storage: CreateVolumeStorage;
  key: TenantSecretsKey;
}): SealedVolumeStorage {
  const auth = storage.auth;
  return {
    volume_storage_endpoint: storage.endpoint,
    volume_storage_bucket: storage.bucket,
    volume_storage_region: storage.region ?? null,
    volume_storage_auth_kind: auth.kind,
    volume_storage_access_key_id: auth.kind === 'anonymous' ? null : auth.accessKeyId,
    volume_storage_secret_access_key:
      auth.kind === 'anonymous' ? null : sealSecret({ key, plaintext: auth.secretAccessKey }),
    volume_storage_session_token:
      auth.kind === 'session' ? sealSecret({ key, plaintext: auth.sessionToken }) : null,
    volume_storage_encryption_password: sealSecret({ key, plaintext: storage.encryptionPassword }),
  };
}

export function volumeStoragePrefix(appId: AppId): S3VolumeStorage['prefix'] {
  return Value.Parse(S3VolumeStorageSchema.properties.prefix, `apps/${appId}/`);
}

export type VolumeStorageMetadataColumns = Pick<
  Queries['SelectAppById'],
  | 'volume_storage_endpoint'
  | 'volume_storage_bucket'
  | 'volume_storage_prefix'
  | 'volume_storage_region'
  | 'volume_storage_auth_kind'
>;

export function toVolumeStorageMetadata(
  row: VolumeStorageMetadataColumns,
): VolumeStorageMetadata | undefined {
  if (row.volume_storage_endpoint === null) {
    return undefined;
  }
  return Value.Parse(VolumeStorageMetadataSchema, {
    endpoint: row.volume_storage_endpoint,
    bucket: row.volume_storage_bucket,
    prefix: row.volume_storage_prefix,
    ...(row.volume_storage_region === null ? {} : { region: row.volume_storage_region }),
    auth: { kind: row.volume_storage_auth_kind },
  });
}

export function toVolumeStorage({
  row,
  secretsKey,
}: {
  row: Queries['SelectDesiredVolumes'];
  secretsKey: TenantSecretsKey;
}): S3VolumeStorage | undefined {
  if (row.volume_storage_endpoint === null) {
    return undefined;
  }
  try {
    const storage = {
      endpoint: row.volume_storage_endpoint,
      bucket: row.volume_storage_bucket,
      prefix: row.volume_storage_prefix,
      ...(row.volume_storage_region === null ? {} : { region: row.volume_storage_region }),
      auth: {
        kind: row.volume_storage_auth_kind,
        ...(row.volume_storage_access_key_id === null
          ? {}
          : { accessKeyId: row.volume_storage_access_key_id }),
        ...(row.volume_storage_secret_access_key === null
          ? {}
          : {
              secretAccessKey: openSecret({
                key: secretsKey,
                sealed: row.volume_storage_secret_access_key,
              }),
            }),
        ...(row.volume_storage_session_token === null
          ? {}
          : {
              sessionToken: openSecret({
                key: secretsKey,
                sealed: row.volume_storage_session_token,
              }),
            }),
      },
      encryptionPassword:
        row.volume_storage_encryption_password === null
          ? undefined
          : openSecret({ key: secretsKey, sealed: row.volume_storage_encryption_password }),
    };
    if (!Value.Check(S3VolumeStorageSchema, storage)) {
      throw new Error('Invalid volume storage configuration.');
    }
    return Value.Parse(S3VolumeStorageSchema, storage);
  } catch {
    // Validation errors may include credential values, so none crosses the polling error log.
    throw new Error('Stored volume storage configuration is invalid or could not be opened.');
  }
}
