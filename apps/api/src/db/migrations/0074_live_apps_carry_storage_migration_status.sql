CREATE OR REPLACE VIEW nibrun.live_apps AS
  SELECT id, owner_id, slug, state, created_at, updated_at, activation, idle_timeout_ms,
         data_initialized_at, name, volume_storage_migration_state,
         volume_storage_migration_message, volume_storage_migration_started_at
  FROM nibrun.apps
  WHERE state <> 'deleted';
