ALTER TABLE nibrun.apps
  ADD COLUMN access_kind text NOT NULL DEFAULT 'public',
  ADD COLUMN access_header text,
  ADD COLUMN access_format text CHECK (access_format IN ('raw', 'bearer')),
  ADD COLUMN access_issuer text,
  ADD COLUMN access_audiences text[],
  ADD COLUMN access_jwks_url text,
  ADD CONSTRAINT apps_access_policy_check CHECK (
    CASE access_kind
      WHEN 'public' THEN num_nonnulls(access_header, access_format, access_issuer, access_audiences,
                                      access_jwks_url) = 0
      WHEN 'jwt' THEN access_header IS NOT NULL AND access_header <> ''
                 AND access_format IS NOT NULL
                 AND access_issuer IS NOT NULL AND btrim(access_issuer) <> ''
                 AND access_audiences IS NOT NULL AND cardinality(access_audiences) > 0
                 AND array_position(access_audiences, NULL) IS NULL
                 AND access_jwks_url IS NOT NULL AND access_jwks_url LIKE 'https://%'
      ELSE false
    END
  );
CREATE OR REPLACE VIEW nibrun.live_apps AS
  SELECT id, owner_id, slug, state, created_at, updated_at, activation, idle_timeout_ms,
         data_initialized_at, name, volume_storage_migration_state,
         volume_storage_migration_message, volume_storage_migration_started_at,
         access_kind, access_header, access_format, access_issuer, access_audiences,
         access_jwks_url
  FROM nibrun.apps
  WHERE state <> 'deleted';
