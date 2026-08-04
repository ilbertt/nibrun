-- A deployment is one artifact plus the configuration it was launched with. `app_configs` is
-- append-only, so naming the row is enough to pin it: a rollback replays exactly what ran
-- rather than whatever the app has been reconfigured with since, and without a second copy of
-- the config that could drift from the first.
--
-- One deployment is one microVM, so what the protocol calls an instance is these columns
-- rather than a table: `desired_state` is what an owner asked for and everything below it is
-- what the host answered. Keeping the two apart is what stops a request for a deploy from
-- reading as a deploy that happened.
--
-- The CHECKs repeat DEPLOYMENT_STATES and DESIRED_INSTANCE_STATES from @repo/protocol and
-- nothing compares them, so adding a state there is also a migration here.

CREATE TABLE nibrun.deployments (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  app_id          uuid NOT NULL REFERENCES nibrun.apps (id) ON DELETE CASCADE,
  artifact_id     uuid NOT NULL REFERENCES nibrun.artifacts (id) ON DELETE RESTRICT,
  config_id       uuid NOT NULL REFERENCES nibrun.app_configs (id) ON DELETE RESTRICT,
  desired_state   text NOT NULL DEFAULT 'stopped',
  state           text NOT NULL DEFAULT 'pending',
  host_port       integer,
  guest_ipv4      text,
  restart_count   integer NOT NULL DEFAULT 0,
  message         text,
  started_at      timestamptz,
  last_healthy_at timestamptz,
  activated_at    timestamptz,
  created_at      timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deployments_desired_state_check CHECK (desired_state IN ('running', 'stopped')),
  CONSTRAINT deployments_state_check
    CHECK (state IN ('pending', 'starting', 'active', 'superseded', 'failed', 'cancelled'))
);

COMMENT ON COLUMN nibrun.deployments.id IS $c$@type import('@repo/protocol').DeploymentId$c$;
COMMENT ON COLUMN nibrun.deployments.app_id IS $c$@type import('@repo/protocol').AppId$c$;
COMMENT ON COLUMN nibrun.deployments.artifact_id IS $c$@type import('@repo/protocol').ArtifactId$c$;
COMMENT ON COLUMN nibrun.deployments.config_id IS 'The app config version this deployment was launched with.';
COMMENT ON COLUMN nibrun.deployments.desired_state IS $c$@type import('@repo/protocol').DesiredInstanceState$c$;
COMMENT ON COLUMN nibrun.deployments.state IS $c$What the host last reported, not what was asked for. @type import('@repo/protocol').DeploymentState$c$;
COMMENT ON COLUMN nibrun.deployments.host_port IS $c$@type import('@repo/protocol').HostPort$c$;
COMMENT ON COLUMN nibrun.deployments.guest_ipv4 IS $c$@type import('@repo/protocol').Ipv4Address$c$;
COMMENT ON COLUMN nibrun.deployments.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE INDEX deployments_app_id_idx ON nibrun.deployments (app_id);

-- Not redundant with the primary key: this is the index the artifact_id foreign key's own
-- check reads, and without it deleting an artifact seq-scans every deployment.
CREATE INDEX deployments_artifact_id_idx ON nibrun.deployments (artifact_id);

CREATE INDEX deployments_config_id_idx ON nibrun.deployments (config_id);

-- One app serves one deployment at a time, and which one is a fact about the row rather than
-- a column on the app, so the constraint that keeps it single lives here.
CREATE UNIQUE INDEX deployments_active_idx ON nibrun.deployments (app_id) WHERE state = 'active';

-- The same, one step earlier: an app can only ever be asking for one deployment to run, which
-- is what makes activating another one a swap rather than a second microVM.
CREATE UNIQUE INDEX deployments_running_idx
  ON nibrun.deployments (app_id) WHERE desired_state = 'running';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON nibrun.deployments
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();
