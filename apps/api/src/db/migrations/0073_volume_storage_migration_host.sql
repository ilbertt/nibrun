ALTER TABLE nibrun.apps
  ADD COLUMN volume_storage_migration_host_id text,
  ADD CONSTRAINT apps_volume_storage_migration_host_check CHECK (
    volume_storage_migration_host_id IS NULL
    OR (
      volume_storage_migration_started_at IS NOT NULL
      AND length(volume_storage_migration_host_id) > 0
    )
  );

COMMENT ON COLUMN nibrun.apps.volume_storage_migration_host_id IS
  $c$The host that owns this started attempt; recovery must not accept another host's cleanup. @type import('@repo/protocol').HostId$c$;
