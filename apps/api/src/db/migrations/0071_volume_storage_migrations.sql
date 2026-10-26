ALTER TABLE nibrun.apps
  ADD COLUMN volume_storage_migration_state text,
  ADD COLUMN volume_storage_migration_message text,
  ADD CONSTRAINT apps_volume_storage_migration_state_check CHECK (
    volume_storage_migration_state IS NULL
    OR volume_storage_migration_state IN ('pending', 'completed', 'failed', 'cancelled')
  );

COMMENT ON COLUMN nibrun.apps.volume_storage_migration_state IS
  $c$While pending, the latest app_config holds the destination and deployments and config edits wait. @type import('#lib/api/volume-storage-migration.ts').VolumeStorageMigrationState$c$;
