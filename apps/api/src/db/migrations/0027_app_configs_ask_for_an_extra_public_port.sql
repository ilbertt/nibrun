-- An app is reached on one public port, and some need a second for a protocol HTTP cannot carry.
-- Which port it is is not stored: it has to be the same on every hop, so it is derived from the
-- slot the app holds on its host, and this column is only whether to derive one at all.
--
-- Default false, so every config version written before this asked for nothing, which is what
-- they meant.

ALTER TABLE nibrun.app_configs
  ADD COLUMN has_extra_public_port boolean NOT NULL DEFAULT false;

-- `SELECT c.*` was expanded into a column list when the view was created, so a new column on the
-- table does not reach it. Dropped and recreated rather than replaced: the expansion now puts the
-- new column before `environment_names`, and CREATE OR REPLACE may not reorder.
DROP VIEW nibrun.app_configs_with_environment;

CREATE VIEW nibrun.app_configs_with_environment AS
  SELECT c.*,
         ARRAY(SELECT e.name FROM nibrun.app_config_environment e
                WHERE e.config_id = c.id ORDER BY e.name) AS environment_names
  FROM nibrun.app_configs c;

COMMENT ON COLUMN nibrun.app_configs_with_environment.environment_names IS
  'Names of the variables this config version runs with, never their values.';

-- Appended last for the reason `config_id` was: CREATE OR REPLACE may only add columns at the end,
-- and dropping this one would take `desired_hostnames` and `desired_environment` with it.
CREATE OR REPLACE VIEW nibrun.desired_deployments AS
  SELECT d.id,
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
         c.has_extra_public_port
  FROM nibrun.deployments d
  JOIN nibrun.apps a ON a.id = d.app_id
  JOIN nibrun.artifacts ar ON ar.id = d.artifact_id
  JOIN nibrun.app_configs c ON c.id = d.config_id
  WHERE d.state NOT IN ('superseded', 'failed') AND a.state IN ('active', 'suspended');
