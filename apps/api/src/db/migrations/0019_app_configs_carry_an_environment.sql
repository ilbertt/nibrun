-- Migration 0006 left `environment` out with a note that secrets storage was deferred. This is
-- that storage: one row per variable, alongside the config version it belongs to.
--
-- A table rather than a column on `app_configs`, following `app_hostnames`: what an app has a
-- fixed number of is a column there, and what it has any number of is a table of its own.
--
-- Names are stored as they were written and values only ever sealed by the api. An owner has to
-- be told which variables are set without being told what they hold, and a name in the clear is
-- what makes that answerable without opening anything.
--
-- The CHECK repeats ENVIRONMENT_NAME_PATTERN from @repo/protocol and nothing compares the two, so
-- changing it there is also a migration here. It is worth restating: a name is what a schema is
-- most likely to wave through, and this is the layer that cannot be talked past.
CREATE TABLE nibrun.app_config_environment (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  config_id  uuid NOT NULL REFERENCES nibrun.app_configs (id) ON DELETE RESTRICT,
  name       text NOT NULL,
  value      text NOT NULL,
  created_at timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  CONSTRAINT app_config_environment_name_key UNIQUE (config_id, name),
  CONSTRAINT app_config_environment_name_check CHECK (name ~ '^[A-Za-z_][A-Za-z0-9_]*$')
);

COMMENT ON COLUMN nibrun.app_config_environment.value IS
  $c$Sealed by the api before it arrives. Never written or read in the clear.$c$;
COMMENT ON COLUMN nibrun.app_config_environment.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE INDEX app_config_environment_config_id_idx
  ON nibrun.app_config_environment (config_id);

-- A config version is what a deployment pins, and its environment is part of that version. The
-- parent refuses a rewrite; without this its variables would still take one, which would edit
-- what a running deployment was launched with.
CREATE TRIGGER app_config_environment_append_only
  BEFORE UPDATE OR DELETE ON nibrun.app_config_environment
  FOR EACH ROW EXECUTE FUNCTION nibrun.refuse_write();

-- A config version with the names of its variables alongside it, so the nine queries that read a
-- config say `environment_names` rather than each carrying its own copy of the subquery. Values
-- are deliberately absent: this is what an owner may be shown.
CREATE VIEW nibrun.app_configs_with_environment AS
  SELECT c.*,
         ARRAY(SELECT e.name FROM nibrun.app_config_environment e
                WHERE e.config_id = c.id ORDER BY e.name) AS environment_names
  FROM nibrun.app_configs c;

-- ARRAY() yields an empty array rather than NULL, but the catalog cannot say that of an
-- expression and a marker here is only read on a base column, so each query pragmas it instead.
COMMENT ON COLUMN nibrun.app_configs_with_environment.environment_names IS
  'Names of the variables this config version runs with, never their values.';

-- `config_id` is appended so the variables of a pinned version can be found from it, the way
-- `desired_hostnames` hangs off this view rather than rebuilding its joins. CREATE OR REPLACE
-- may only add columns at the end, which is also why it is last.
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
         d.config_id
  FROM nibrun.deployments d
  JOIN nibrun.apps a ON a.id = d.app_id
  JOIN nibrun.artifacts ar ON ar.id = d.artifact_id
  JOIN nibrun.app_configs c ON c.id = d.config_id
  WHERE d.state NOT IN ('superseded', 'failed') AND a.state IN ('active', 'suspended');

-- The one relation carrying values rather than names: it is read on the way to the host that
-- runs the binary, which is the only place they are wanted.
CREATE VIEW nibrun.desired_environment AS
  SELECT d.id AS deployment_id, e.name, e.value
  FROM nibrun.app_config_environment e
  JOIN nibrun.desired_deployments d ON d.config_id = e.config_id;
