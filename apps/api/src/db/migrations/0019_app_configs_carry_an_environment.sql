-- Migration 0006 left `environment` out with a note that secrets storage was deferred. This is
-- that storage: one jsonb object per config version, names in the clear and every value sealed
-- by the api before it arrives, so a dump or a nightly backup carries ciphertext.
--
-- Names stay readable because an owner has to be told which variables are set without being told
-- what they are, and because nothing else can list them once the values are opaque.
--
-- On the config row rather than the app: a deployment snapshots the config it launched with, so
-- a rollback replays the environment of the version it rolls back to rather than whatever is
-- current.
ALTER TABLE nibrun.app_configs
  ADD COLUMN environment jsonb NOT NULL DEFAULT '{}'::jsonb;

-- An object, never an array or a scalar: the api parses what it reads back, and a row shaped
-- wrongly is a tenant that cannot start rather than a validation error an owner could act on.
ALTER TABLE nibrun.app_configs
  ADD CONSTRAINT app_configs_environment_check
    CHECK (jsonb_typeof(environment) = 'object');

COMMENT ON COLUMN nibrun.app_configs.environment IS
  $c$Variable name to the value sealed by the api. Never written or read in the clear. @notNull @type Record<string, string>$c$;

-- Appended rather than placed with the other config columns: CREATE OR REPLACE VIEW may only add
-- columns at the end, and replacing the view outright would mean dropping the one that depends
-- on it.
CREATE OR REPLACE VIEW nibrun.desired_deployments AS
  SELECT d.id,
         d.app_id,
         a.state,
         ar.digest, ar.size_bytes, ar.object_key, ar.original_file_name,
         c.guest_port, c.args, c.vcpu_count, c.memory_mib,
         c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
         c.health_check_grace_period_ms, c.health_check_healthy_threshold,
         c.health_check_unhealthy_threshold,
         c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
         c.restart_backoff_factor, c.restart_reset_after_ms,
         c.environment
  FROM nibrun.deployments d
  JOIN nibrun.apps a ON a.id = d.app_id
  JOIN nibrun.artifacts ar ON ar.id = d.artifact_id
  JOIN nibrun.app_configs c ON c.id = d.config_id
  WHERE d.state NOT IN ('superseded', 'failed') AND a.state IN ('active', 'suspended');
