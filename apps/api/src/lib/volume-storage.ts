import { isPublicRoutableHost } from '@better-auth/core/utils/host';
import { type S3VolumeStorage, S3VolumeStorageSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { Queries } from '#db/queries.gen.ts';
import type { CustomerVolumeInput } from '#lib/api/customer-volume.ts';
import { BadRequestError, ConflictError } from '#lib/errors.ts';
import { hostnameOf } from '#lib/public-address.ts';
import { openSecret, sealSecret, type TenantSecretsKey } from '#lib/tenant-secrets.ts';

export const MANAGED_VOLUME_STORAGE = {
  volume_storage_endpoint: null,
  volume_storage_bucket: null,
  volume_storage_prefix: null,
  volume_storage_region: null,
  volume_storage_auth_kind: null,
  volume_storage_access_key_id: null,
  volume_storage_secret_access_key: null,
  volume_storage_session_token: null,
  volume_storage_encryption_password: null,
};

export type StoredVolumeStorage = Pick<
  Queries['SelectCurrentAppConfig'],
  keyof typeof MANAGED_VOLUME_STORAGE
>;

export type VolumeStorageDestination = Omit<StoredVolumeStorage, 'volume_storage_prefix'> & {
  [Key in
    | 'volume_storage_endpoint'
    | 'volume_storage_bucket'
    | 'volume_storage_auth_kind'
    | 'volume_storage_encryption_password']: NonNullable<StoredVolumeStorage[Key]>;
};

const MIN_PASSWORD_BYTES = 8;

export function validatedVolumeStorage(storage: CustomerVolumeInput): CustomerVolumeInput {
  const url = URL.parse(storage.endpoint);
  if (
    url?.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.href.includes('?') ||
    url.href.includes('#') ||
    !isPublicRoutableHost(hostnameOf(url))
  ) {
    throw new BadRequestError(
      'Specify a public HTTPS bucket endpoint without credentials, a query, or a fragment.',
    );
  }
  if (
    Buffer.byteLength(storage.encryptionPassword) < MIN_PASSWORD_BYTES ||
    storage.encryptionPassword === 'CHANGEME'
  ) {
    throw new BadRequestError(
      'Use a ZeroFS encryption password of at least eight bytes, different from the example password.',
    );
  }
  return { ...storage, endpoint: url.href.replace(/\/+$/, '') };
}

export function sealVolumeStorage({
  storage: input,
  key,
}: {
  storage: CustomerVolumeInput;
  key: TenantSecretsKey;
}): VolumeStorageDestination {
  const storage = validatedVolumeStorage(input);
  const { auth } = storage;
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

export function requireManagedImportStorage(bucket: string | null) {
  if (bucket !== null) {
    throw new ConflictError(
      'Initial data archives use nibrun storage and cannot be imported into a customer volume.',
    );
  }
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
