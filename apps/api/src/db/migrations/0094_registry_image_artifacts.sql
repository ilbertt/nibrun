ALTER TABLE nibrun.artifacts
  ALTER COLUMN original_file_name DROP NOT NULL,
  ADD COLUMN image_repository text,
  ADD COLUMN image_program text,
  ADD COLUMN image_working_directory text,
  ADD CONSTRAINT artifacts_source_check CHECK (
    (image_repository IS NULL AND image_program IS NULL AND image_working_directory IS NULL
      AND original_file_name IS NOT NULL)
    OR
    (image_repository IS NOT NULL AND image_program IS NOT NULL AND image_working_directory IS NOT NULL
      AND digest IS NOT NULL AND size_bytes IS NULL AND object_key IS NULL
      AND original_file_name IS NULL AND original_file_url IS NULL AND source_digest IS NULL)
  );

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
         c.access_kind, c.access_header, c.access_format, c.access_issuer, c.access_audiences, c.access_jwks_url,
         ar.image_repository, ar.image_program, ar.image_working_directory
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
