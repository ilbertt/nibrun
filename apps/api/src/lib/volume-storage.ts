import { type S3VolumeStorage, S3VolumeStorageSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { Queries } from '#db/queries.gen.ts';
import type { CustomerVolume } from '#lib/api/customer-volume.ts';
import { BadRequestError } from '#lib/errors.ts';
import { openSecret, sealSecret, type TenantSecretsKey } from '#lib/tenant-secrets.ts';

export type StoredVolumeStorage = Pick<
  Queries['SelectCurrentAppConfig'],
  | 'volume_storage_endpoint'
  | 'volume_storage_bucket'
  | 'volume_storage_prefix'
  | 'volume_storage_region'
  | 'volume_storage_auth_kind'
  | 'volume_storage_access_key_id'
  | 'volume_storage_secret_access_key'
  | 'volume_storage_session_token'
  | 'volume_storage_encryption_password'
>;

const MIN_ZEROFS_PASSWORD_BYTES = 8;

export function sealCustomerVolume({
  storage,
  key,
}: {
  storage: CustomerVolume;
  key: TenantSecretsKey;
}) {
  const endpoint = URL.parse(storage.endpoint);
  if (
    endpoint?.protocol !== 'https:' ||
    !endpoint.hostname ||
    endpoint.username ||
    endpoint.password ||
    endpoint.href.includes('?') ||
    endpoint.href.includes('#')
  ) {
    throw new BadRequestError(
      'Customer storage requires an HTTPS endpoint without URL credentials, query, or fragment.',
    );
  }
  if (
    Buffer.byteLength(storage.encryptionPassword) < MIN_ZEROFS_PASSWORD_BYTES ||
    storage.encryptionPassword === 'CHANGEME'
  ) {
    throw new BadRequestError(
      'Choose a ZeroFS password of at least eight bytes other than its example password.',
    );
  }
  const { auth } = storage;
  const secrets = [
    storage.encryptionPassword,
    ...(auth.kind === 'anonymous' ? [] : [auth.accessKeyId, auth.secretAccessKey]),
    ...(auth.kind === 'session' ? [auth.sessionToken] : []),
  ];
  if (
    secrets.some(
      (secret) =>
        Buffer.byteLength(secret) > S3VolumeStorageSchema.properties.encryptionPassword.maxLength!,
    )
  ) {
    throw new BadRequestError('A customer storage credential exceeds the size limit.');
  }
  return {
    volume_storage_endpoint: endpoint.href.replace(/\/$/, ''),
    volume_storage_bucket: storage.bucket,
    volume_storage_region: storage.region ?? null,
    volume_storage_auth_kind: auth.kind,
    volume_storage_access_key_id: auth.kind === 'anonymous' ? null : auth.accessKeyId,
    volume_storage_secret_access_key:
      auth.kind === 'anonymous' ? null : sealSecret({ key, plaintext: auth.secretAccessKey }),
    volume_storage_session_token:
      auth.kind === 'session' ? sealSecret({ key, plaintext: auth.sessionToken }) : null,
    volume_storage_encryption_password: sealSecret({ key, plaintext: storage.encryptionPassword }),
  } satisfies Omit<StoredVolumeStorage, 'volume_storage_prefix'>;
}

export function initialVolumeStorage({
  appId,
  storage,
}: {
  appId: string;
  storage: ReturnType<typeof sealCustomerVolume> | undefined;
}): StoredVolumeStorage {
  if (storage) {
    return {
      ...storage,
      volume_storage_prefix: Value.Parse(S3VolumeStorageSchema.properties.prefix, `apps/${appId}`),
    };
  }
  return {
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
