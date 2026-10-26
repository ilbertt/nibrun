import type { AppId } from '@repo/protocol';
import type { IVolumeStorageMigrationsColumns, Queries } from '#db/queries.gen.ts';
import type { OwnerId, VolumeStorageMigrationId } from '#lib/api/identifiers.ts';
import { Repository } from '#repositories/repository.ts';

export type VolumeStorageMigrationRow = Queries['SelectVolumeStorageMigrationById'];
export type VolumeStorageMigrationDestination = Pick<
  IVolumeStorageMigrationsColumns,
  | 'volume_storage_endpoint'
  | 'volume_storage_bucket'
  | 'volume_storage_region'
  | 'volume_storage_auth_kind'
  | 'volume_storage_access_key_id'
  | 'volume_storage_secret_access_key'
  | 'volume_storage_session_token'
  | 'volume_storage_encryption_password'
>;

type OwnedApp = { appId: AppId; ownerId: OwnerId };
export type RequestVolumeStorageMigrationInput = OwnedApp & {
  destination: VolumeStorageMigrationDestination;
};
export type VolumeStorageMigrationByIdInput = OwnedApp & {
  migrationId: VolumeStorageMigrationId;
};

export abstract class VolumeStorageMigrationsRepositoryContract {
  abstract request(
    input: RequestVolumeStorageMigrationInput,
  ): Promise<VolumeStorageMigrationRow | null>;
  abstract findById(
    input: VolumeStorageMigrationByIdInput,
  ): Promise<VolumeStorageMigrationRow | null>;
}

export class VolumeStorageMigrationsRepository
  extends Repository
  implements VolumeStorageMigrationsRepositoryContract
{
  async request({
    appId,
    ownerId,
    destination,
  }: RequestVolumeStorageMigrationInput): Promise<VolumeStorageMigrationRow | null> {
    const [inserted] = await this.sql.InsertVolumeStorageMigration`
      WITH migration AS (SELECT uuidv7() AS id)
      INSERT INTO nibrun.volume_storage_migrations (
        id, app_id, source_config_id,
        volume_storage_endpoint, volume_storage_bucket, volume_storage_prefix,
        volume_storage_region, volume_storage_auth_kind, volume_storage_access_key_id,
        volume_storage_secret_access_key, volume_storage_session_token, volume_storage_encryption_password
      )
      SELECT migration.id, a.id, c.id,
             ${destination.volume_storage_endpoint}, ${destination.volume_storage_bucket},
             'apps/' || a.id::text || '/' || migration.id::text || '/',
             ${destination.volume_storage_region}, ${destination.volume_storage_auth_kind},
             ${destination.volume_storage_access_key_id}, ${destination.volume_storage_secret_access_key},
             ${destination.volume_storage_session_token}, ${destination.volume_storage_encryption_password}
      FROM nibrun.live_apps a
      JOIN LATERAL (
        SELECT config_id FROM nibrun.deployments d
        WHERE d.app_id = a.id ORDER BY d.id DESC LIMIT 1
      ) d ON true
      JOIN nibrun.app_configs c ON c.id = d.config_id
      CROSS JOIN migration
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId} AND a.state IN ('active', 'suspended')
        AND c.volume_storage_endpoint IS NULL
      ON CONFLICT (app_id) WHERE state = 'pending' DO NOTHING
      RETURNING id
    `;
    if (inserted) {
      return this.findById({ appId, ownerId, migrationId: inserted.id });
    }
    const [pending] = await this.sql.SelectPendingVolumeStorageMigration`
      SELECT m.id, m.app_id, m.source_config_id, m.state, m.message,
             m.volume_storage_endpoint, m.volume_storage_bucket, m.volume_storage_prefix,
             m.volume_storage_region, m.volume_storage_auth_kind, m.created_at, m.updated_at
      FROM nibrun.volume_storage_migrations m
      JOIN nibrun.live_apps a ON a.id = m.app_id
      WHERE m.app_id = ${appId} AND a.owner_id = ${ownerId} AND m.state = 'pending'
        AND a.state IN ('active', 'suspended')
    `;
    return pending ?? null;
  }

  async findById({
    appId,
    ownerId,
    migrationId,
  }: VolumeStorageMigrationByIdInput): Promise<VolumeStorageMigrationRow | null> {
    const [row] = await this.sql.SelectVolumeStorageMigrationById`
      SELECT m.id, m.app_id, m.source_config_id, m.state, m.message,
             m.volume_storage_endpoint, m.volume_storage_bucket, m.volume_storage_prefix,
             m.volume_storage_region, m.volume_storage_auth_kind, m.created_at, m.updated_at
      FROM nibrun.volume_storage_migrations m
      JOIN nibrun.live_apps a ON a.id = m.app_id
      WHERE m.id = ${migrationId} AND m.app_id = ${appId} AND a.owner_id = ${ownerId}
    `;
    return row ?? null;
  }
}
