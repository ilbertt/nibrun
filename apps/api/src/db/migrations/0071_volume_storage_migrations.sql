CREATE TABLE nibrun.volume_storage_migrations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  app_id uuid NOT NULL REFERENCES nibrun.apps (id) ON DELETE RESTRICT,
  source_config_id uuid NOT NULL REFERENCES nibrun.app_configs (id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'pending',
  volume_storage_endpoint text NOT NULL CHECK (length(volume_storage_endpoint) > 0),
  volume_storage_bucket text NOT NULL CHECK (length(volume_storage_bucket) > 0),
  volume_storage_prefix text NOT NULL CHECK (length(volume_storage_prefix) > 0),
  volume_storage_region text CHECK (volume_storage_region IS NULL OR length(volume_storage_region) > 0),
  volume_storage_auth_kind text NOT NULL,
  volume_storage_access_key_id text,
  volume_storage_secret_access_key text,
  volume_storage_session_token text,
  volume_storage_encryption_password text NOT NULL CHECK (length(volume_storage_encryption_password) > 0),
  message text,
  created_at timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT volume_storage_migrations_state_check CHECK (state IN ('pending', 'completed', 'failed', 'cancelled')),
  CONSTRAINT volume_storage_migrations_auth_check CHECK (
    CASE
      WHEN volume_storage_auth_kind = 'anonymous' THEN
        volume_storage_access_key_id IS NULL AND volume_storage_secret_access_key IS NULL
        AND volume_storage_session_token IS NULL
      WHEN volume_storage_auth_kind IN ('access-key', 'session') THEN
        volume_storage_access_key_id IS NOT NULL AND length(volume_storage_access_key_id) > 0
        AND volume_storage_secret_access_key IS NOT NULL AND length(volume_storage_secret_access_key) > 0
        AND CASE WHEN volume_storage_auth_kind = 'session'
          THEN volume_storage_session_token IS NOT NULL AND length(volume_storage_session_token) > 0
          ELSE volume_storage_session_token IS NULL
        END
      ELSE false
    END
  )
);

COMMENT ON TABLE nibrun.volume_storage_migrations IS
  'Pending destinations stay outside app_configs so normal deployments cannot select them before migration.';
COMMENT ON COLUMN nibrun.volume_storage_migrations.id IS $c$@type import('#lib/api/identifiers.ts').VolumeStorageMigrationId$c$;
COMMENT ON COLUMN nibrun.volume_storage_migrations.app_id IS $c$@type import('@repo/protocol').AppId$c$;
COMMENT ON COLUMN nibrun.volume_storage_migrations.state IS $c$@type import('#lib/api/volume-storage-migration.ts').VolumeStorageMigrationState$c$;
COMMENT ON COLUMN nibrun.volume_storage_migrations.volume_storage_auth_kind IS $c$@type import('@repo/protocol').S3VolumeAuth['kind']$c$;
COMMENT ON COLUMN nibrun.volume_storage_migrations.volume_storage_prefix IS $c$@type import('@repo/protocol').ObjectKey$c$;
COMMENT ON COLUMN nibrun.volume_storage_migrations.volume_storage_secret_access_key IS $c$Sealed with TENANT_SECRETS_KEY. @type import('#lib/tenant-secrets.ts').SealedSecret$c$;
COMMENT ON COLUMN nibrun.volume_storage_migrations.volume_storage_session_token IS $c$Sealed with TENANT_SECRETS_KEY. @type import('#lib/tenant-secrets.ts').SealedSecret$c$;
COMMENT ON COLUMN nibrun.volume_storage_migrations.volume_storage_encryption_password IS $c$Sealed with TENANT_SECRETS_KEY. @type import('#lib/tenant-secrets.ts').SealedSecret$c$;
COMMENT ON COLUMN nibrun.volume_storage_migrations.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE UNIQUE INDEX volume_storage_migrations_pending_app_idx
  ON nibrun.volume_storage_migrations (app_id) WHERE state = 'pending';
CREATE INDEX volume_storage_migrations_app_id_idx ON nibrun.volume_storage_migrations (app_id);
CREATE INDEX volume_storage_migrations_source_config_id_idx ON nibrun.volume_storage_migrations (source_config_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON nibrun.volume_storage_migrations
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();
