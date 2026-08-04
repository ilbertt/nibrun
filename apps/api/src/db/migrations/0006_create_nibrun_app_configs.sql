-- Every bound below is the one @repo/protocol already states, restated where the data lands.
-- Per-argument length is the exception: checking it needs a subquery over `args`, which a
-- CHECK constraint may not contain.

CREATE TABLE nibrun.app_configs (
  id                               uuid PRIMARY KEY DEFAULT uuidv7(),
  app_id                           uuid NOT NULL REFERENCES nibrun.apps (id) ON DELETE RESTRICT,
  guest_port                       integer NOT NULL,
  args                             text[] NOT NULL,
  vcpu_count                       integer NOT NULL,
  memory_mib                       integer NOT NULL,
  health_check_path                text,
  health_check_interval_ms         integer NOT NULL,
  health_check_timeout_ms          integer NOT NULL,
  health_check_grace_period_ms     integer NOT NULL,
  health_check_healthy_threshold   integer NOT NULL,
  health_check_unhealthy_threshold integer NOT NULL,
  restart_max_restarts             integer NOT NULL,
  restart_initial_backoff_ms       integer NOT NULL,
  restart_max_backoff_ms           integer NOT NULL,
  restart_backoff_factor           double precision NOT NULL,
  restart_reset_after_ms           integer NOT NULL,
  created_at                       timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  CONSTRAINT app_configs_guest_port_check CHECK (guest_port BETWEEN 1 AND 65535),
  CONSTRAINT app_configs_args_check CHECK (cardinality(args) <= 64),
  CONSTRAINT app_configs_vcpu_count_check CHECK (vcpu_count BETWEEN 1 AND 32),
  CONSTRAINT app_configs_memory_mib_check CHECK (memory_mib BETWEEN 128 AND 16384),
  CONSTRAINT app_configs_health_check_path_check
    CHECK (length(health_check_path) BETWEEN 1 AND 1024),
  CONSTRAINT app_configs_health_check_interval_ms_check CHECK (health_check_interval_ms >= 100),
  CONSTRAINT app_configs_health_check_timeout_ms_check CHECK (health_check_timeout_ms >= 100),
  CONSTRAINT app_configs_health_check_grace_period_ms_check
    CHECK (health_check_grace_period_ms >= 0),
  CONSTRAINT app_configs_health_check_healthy_threshold_check
    CHECK (health_check_healthy_threshold >= 1),
  CONSTRAINT app_configs_health_check_unhealthy_threshold_check
    CHECK (health_check_unhealthy_threshold >= 1),
  CONSTRAINT app_configs_restart_max_restarts_check CHECK (restart_max_restarts >= 0),
  CONSTRAINT app_configs_restart_initial_backoff_ms_check CHECK (restart_initial_backoff_ms >= 0),
  CONSTRAINT app_configs_restart_max_backoff_ms_check CHECK (restart_max_backoff_ms >= 0),
  CONSTRAINT app_configs_restart_backoff_factor_check CHECK (restart_backoff_factor >= 1),
  CONSTRAINT app_configs_restart_reset_after_ms_check CHECK (restart_reset_after_ms >= 0)
);

COMMENT ON COLUMN nibrun.app_configs.app_id IS $c$@type import('@repo/protocol').AppId$c$;
COMMENT ON COLUMN nibrun.app_configs.guest_port IS $c$@type import('@repo/protocol').GuestPort$c$;
COMMENT ON COLUMN nibrun.app_configs.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

-- An app's current config is its newest row, so there is no pointer to keep in step with the
-- table. That works because `id` is uuidv7 and Postgres compares uuid byte-wise: the timestamp
-- sits big-endian in the leading bytes, so highest id is newest row. Rows are never updated or
-- deleted, so a later version can never lose that position.
--
-- `id` trails `app_id` here to make `ORDER BY id DESC LIMIT 1` one walk of the index rather
-- than a sort of every version an app has. Leading `app_id` also serves the foreign key's own
-- check, so this replaces the plain index on that column rather than joining it.
CREATE INDEX app_configs_app_id_id_idx ON nibrun.app_configs (app_id, id);

CREATE FUNCTION nibrun.refuse_write() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % refused', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER app_configs_append_only
  BEFORE UPDATE OR DELETE ON nibrun.app_configs
  FOR EACH ROW EXECUTE FUNCTION nibrun.refuse_write();
