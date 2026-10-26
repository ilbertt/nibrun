ALTER TABLE nibrun.apps
  ADD COLUMN volume_storage_migration_started_at timestamptz;

COMMENT ON COLUMN nibrun.apps.volume_storage_migration_started_at IS
  'Recorded before any host-side migration work. Once set, timeout recovery must wait for host cleanup confirmation.';

CREATE INDEX apps_unstarted_volume_storage_migrations_idx
  ON nibrun.apps (id)
  WHERE volume_storage_migration_state = 'pending'
    AND volume_storage_migration_started_at IS NULL;
