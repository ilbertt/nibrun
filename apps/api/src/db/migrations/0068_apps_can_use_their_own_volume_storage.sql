ALTER TABLE nibrun.app_configs
  ADD COLUMN volume_storage_endpoint text,
  ADD COLUMN volume_storage_bucket text,
  ADD COLUMN volume_storage_prefix text,
  ADD COLUMN volume_storage_region text,
  ADD COLUMN volume_storage_auth_kind text,
  ADD COLUMN volume_storage_access_key_id text,
  ADD COLUMN volume_storage_secret_access_key text,
  ADD COLUMN volume_storage_session_token text,
  ADD COLUMN volume_storage_encryption_password text,
  ADD CONSTRAINT app_configs_volume_storage_target_check CHECK (
    CASE WHEN volume_storage_endpoint IS NULL THEN
      volume_storage_bucket IS NULL AND volume_storage_prefix IS NULL
      AND volume_storage_region IS NULL AND volume_storage_encryption_password IS NULL
    ELSE
      volume_storage_bucket IS NOT NULL AND volume_storage_prefix IS NOT NULL
      AND volume_storage_encryption_password IS NOT NULL
      AND length(volume_storage_endpoint) > 0 AND length(volume_storage_bucket) > 0
      AND length(volume_storage_prefix) > 0 AND length(volume_storage_encryption_password) > 0
      AND (volume_storage_region IS NULL OR length(volume_storage_region) > 0)
    END
  ),
  ADD CONSTRAINT app_configs_volume_storage_auth_check CHECK (
    CASE
      WHEN volume_storage_auth_kind IS NULL THEN
        volume_storage_endpoint IS NULL AND volume_storage_access_key_id IS NULL
        AND volume_storage_secret_access_key IS NULL AND volume_storage_session_token IS NULL
      WHEN volume_storage_auth_kind = 'anonymous' THEN
        volume_storage_endpoint IS NOT NULL AND volume_storage_access_key_id IS NULL
        AND volume_storage_secret_access_key IS NULL AND volume_storage_session_token IS NULL
      WHEN volume_storage_auth_kind IN ('access-key', 'session') THEN
        volume_storage_endpoint IS NOT NULL
        AND volume_storage_access_key_id IS NOT NULL
        AND volume_storage_secret_access_key IS NOT NULL
        AND length(volume_storage_access_key_id) > 0
        AND length(volume_storage_secret_access_key) > 0
        AND CASE WHEN volume_storage_auth_kind = 'session'
          THEN volume_storage_session_token IS NOT NULL AND length(volume_storage_session_token) > 0
          ELSE volume_storage_session_token IS NULL
        END
      ELSE false
    END
  );

COMMENT ON COLUMN nibrun.app_configs.volume_storage_auth_kind IS $c$@type import('@repo/protocol').S3VolumeAuth['kind']$c$;
COMMENT ON COLUMN nibrun.app_configs.volume_storage_secret_access_key IS $c$Sealed with TENANT_SECRETS_KEY. @type import('#lib/tenant-secrets.ts').SealedSecret$c$;
COMMENT ON COLUMN nibrun.app_configs.volume_storage_session_token IS $c$Sealed with TENANT_SECRETS_KEY. @type import('#lib/tenant-secrets.ts').SealedSecret$c$;
COMMENT ON COLUMN nibrun.app_configs.volume_storage_encryption_password IS $c$Sealed with TENANT_SECRETS_KEY. @type import('#lib/tenant-secrets.ts').SealedSecret$c$;
