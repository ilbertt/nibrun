ALTER TABLE nibrun.app_configs
  ADD COLUMN access_kind text NOT NULL DEFAULT 'public',
  ADD COLUMN access_header text,
  ADD COLUMN access_format text CHECK (access_format IN ('raw', 'bearer')),
  ADD COLUMN access_issuer text,
  ADD COLUMN access_audiences text[],
  ADD COLUMN access_jwks_url text,
  ADD CONSTRAINT app_configs_access_policy_check CHECK (
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

-- Rebind dependent views before removing the access columns from live_apps.
ALTER VIEW nibrun.live_apps RENAME TO live_apps_before_versioned_access;

CREATE VIEW nibrun.live_apps AS
  SELECT id, owner_id, slug, state, created_at, updated_at, activation, idle_timeout_ms,
         data_initialized_at, name, volume_storage_migration_state,
         volume_storage_migration_message, volume_storage_migration_started_at
  FROM nibrun.apps
  WHERE state <> 'deleted';

CREATE OR REPLACE VIEW nibrun.app_quotas AS
  SELECT p.owner_id,
         held.apps_held,
         p.quota_apps_max_count AS apps_allowed,
         GREATEST(p.quota_apps_max_count - held.apps_held, 0) AS apps_left
  FROM nibrun.profiles p
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS apps_held
    FROM nibrun.live_apps a
    WHERE a.owner_id = p.owner_id
  ) held;

CREATE OR REPLACE VIEW nibrun.cached_binaries AS
  SELECT ar.source_digest,
         ar.digest,
         ar.size_bytes,
         ar.object_key,
         ar.original_file_name
  FROM nibrun.artifacts ar
  JOIN nibrun.deployments d ON d.artifact_id = ar.id
  JOIN nibrun.live_apps a ON a.id = ar.app_id
  WHERE ar.source_digest IS NOT NULL
    AND ar.object_key IS NOT NULL
    AND d.activated_at IS NOT NULL;

CREATE OR REPLACE VIEW nibrun.expirable_apps AS
  SELECT a.id AS app_id, a.owner_id
  FROM nibrun.live_apps a
  JOIN nibrun.app_deadlines d ON d.app_id = a.id
  WHERE a.state <> 'deleting'
    AND d.expires_at <= now();

CREATE OR REPLACE VIEW nibrun.valid_github_deployment_grants AS
  SELECT g.*
  FROM nibrun.github_deployment_grants g
  JOIN nibrun.live_apps a ON a.id = g.app_id AND a.owner_id = g.owner_id
  JOIN nibrun.github_trusted_deployment_workflows w
    ON w.id = g.workflow_id AND w.app_id = g.app_id
    AND w.current_revision = g.workflow_revision AND w.deleted_at IS NULL
  WHERE g.expires_at > statement_timestamp();

DROP VIEW nibrun.live_apps_before_versioned_access;
ALTER TABLE nibrun.apps
  DROP COLUMN access_kind,
  DROP COLUMN access_header,
  DROP COLUMN access_format,
  DROP COLUMN access_issuer,
  DROP COLUMN access_audiences,
  DROP COLUMN access_jwks_url;

CREATE OR REPLACE VIEW nibrun.app_configs_with_environment AS
  SELECT c.id, c.app_id, c.http_port, c.args, c.vcpu_count, c.memory_mib,
         c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
         c.health_check_grace_period_ms, c.health_check_healthy_threshold, c.health_check_unhealthy_threshold,
         c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
         c.restart_backoff_factor, c.restart_reset_after_ms, c.created_at, c.has_extra_public_port,
         ARRAY(SELECT e.name FROM nibrun.app_config_environment e WHERE e.config_id = c.id ORDER BY e.name) AS environment_names,
         c.access_kind, c.access_header, c.access_format, c.access_issuer, c.access_audiences, c.access_jwks_url
  FROM nibrun.app_configs c;

CREATE OR REPLACE VIEW nibrun.desired_deployments AS
  SELECT
         d.id,
         d.app_id,
         a.state,
         ar.digest, ar.size_bytes, ar.object_key, ar.original_file_name,
         c.http_port, c.args, c.vcpu_count, c.memory_mib,
         c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
         c.health_check_grace_period_ms, c.health_check_healthy_threshold,
         c.health_check_unhealthy_threshold,
         c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
         c.restart_backoff_factor, c.restart_reset_after_ms,
         d.config_id,
         c.has_extra_public_port,
         a.activation, a.idle_timeout_ms,
         d.state AS deployment_state,
         c.access_kind, c.access_header, c.access_format, c.access_issuer, c.access_audiences, c.access_jwks_url
  FROM nibrun.deployments d
  JOIN nibrun.apps a ON a.id = d.app_id
  JOIN nibrun.artifacts ar ON ar.id = d.artifact_id
  JOIN nibrun.app_configs c ON c.id = d.config_id
  WHERE d.state <> 'superseded'
    AND a.state IN ('active', 'suspended')
    AND NOT EXISTS (
      SELECT 1 FROM nibrun.deployments newer
      WHERE newer.app_id = d.app_id AND newer.state <> 'superseded' AND newer.id > d.id
    );
