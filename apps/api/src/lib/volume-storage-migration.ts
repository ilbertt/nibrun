import type { Queries } from '#db/queries.gen.ts';
import type { VolumeStorageMigration } from '#lib/api/volume-storage-migration.ts';

type MigrationColumns = Pick<
  Queries['SelectAppById'],
  | 'config_id'
  | 'volume_storage_migration_state'
  | 'volume_storage_migration_message'
  | 'volume_storage_migration_started_at'
>;

export function toVolumeStorageMigration(
  row: MigrationColumns,
): VolumeStorageMigration | undefined {
  if (row.volume_storage_migration_state === null) {
    return undefined;
  }
  return {
    configId: row.config_id,
    state: row.volume_storage_migration_state,
    message: row.volume_storage_migration_message,
    canCancel:
      row.volume_storage_migration_state === 'pending' &&
      row.volume_storage_migration_started_at === null,
  };
}
