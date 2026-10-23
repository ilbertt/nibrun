import { type S3VolumeStorage, S3VolumeStorageSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { Queries } from '#db/queries.gen.ts';
import { openSecret, type TenantSecretsKey } from '#lib/tenant-secrets.ts';

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
