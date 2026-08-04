-- A deployment is one artifact plus the configuration it was launched with. `app_configs` is
-- append-only, so naming the row is enough to pin it: a rollback replays exactly what ran
-- rather than whatever the app has been reconfigured with since, and without a second copy of
-- the config that could drift from the first.
--
-- One deployment is one microVM, so what the protocol calls an instance is these columns
-- rather than a table: there is never a second row to point at, and a join would only ever
-- find the row it started from.
--
-- One `state` and no wish beside it: a deployment's life is linear, so every step of it is a
-- state it can be named in. `pending` is asked for and not yet started, `superseded` is
-- replaced by a newer one — neither needs a second column to be sayable. What the host says
-- about the microVM lands in the columns below it.
--
-- `superseded` and `failed` are terminal; a deployment in any other state is one the app is
-- still running, which is what the index below keeps to one per app. Nothing ever moves
-- backwards: going back to an older release is a new row naming the one it replays, so the
-- history says that a rollback happened rather than losing the release it rewound.
--
-- The CHECK repeats DEPLOYMENT_STATES from @repo/protocol and nothing compares the two, so
-- adding a state there is also a migration here.

CREATE TABLE nibrun.deployments (
  id                        uuid PRIMARY KEY DEFAULT uuidv7(),
  app_id                    uuid NOT NULL REFERENCES nibrun.apps (id) ON DELETE RESTRICT,
  artifact_id               uuid NOT NULL REFERENCES nibrun.artifacts (id) ON DELETE RESTRICT,
  config_id                 uuid NOT NULL REFERENCES nibrun.app_configs (id) ON DELETE RESTRICT,
  rollback_of_deployment_id uuid REFERENCES nibrun.deployments (id) ON DELETE RESTRICT,
  state                     text NOT NULL DEFAULT 'pending',
  host_port                 integer,
  guest_ipv4                text,
  restart_count             integer NOT NULL DEFAULT 0,
  message                   text,
  started_at                timestamptz,
  last_healthy_at           timestamptz,
  activated_at              timestamptz,
  created_at                timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deployments_state_check
    CHECK (state IN ('pending', 'starting', 'active', 'superseded', 'failed'))
);

COMMENT ON COLUMN nibrun.deployments.id IS $c$@type import('@repo/protocol').DeploymentId$c$;
COMMENT ON COLUMN nibrun.deployments.app_id IS $c$@type import('@repo/protocol').AppId$c$;
COMMENT ON COLUMN nibrun.deployments.artifact_id IS $c$@type import('@repo/protocol').ArtifactId$c$;
COMMENT ON COLUMN nibrun.deployments.config_id IS 'The app config version this deployment was launched with.';
COMMENT ON COLUMN nibrun.deployments.state IS $c$@type import('@repo/protocol').DeploymentState$c$;
COMMENT ON COLUMN nibrun.deployments.host_port IS $c$@type import('@repo/protocol').HostPort$c$;
COMMENT ON COLUMN nibrun.deployments.guest_ipv4 IS $c$@type import('@repo/protocol').Ipv4Address$c$;
COMMENT ON COLUMN nibrun.deployments.message IS 'Why the deployment is in the state it is in, as the host put it. Never the tenant''s own output, which has a streaming path of its own.';
COMMENT ON COLUMN nibrun.deployments.rollback_of_deployment_id IS $c$The deployment this one replays, when it was made to go back to one. @type import('@repo/protocol').DeploymentId$c$;
COMMENT ON COLUMN nibrun.deployments.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE INDEX deployments_app_id_idx ON nibrun.deployments (app_id);

-- Not redundant with the primary key: this is the index the artifact_id foreign key's own
-- check reads, and without it deleting an artifact seq-scans every deployment.
CREATE INDEX deployments_artifact_id_idx ON nibrun.deployments (artifact_id);

CREATE INDEX deployments_config_id_idx ON nibrun.deployments (config_id);

CREATE INDEX deployments_rollback_of_idx ON nibrun.deployments (rollback_of_deployment_id);

-- One app runs one deployment at a time, and which one is a fact about the row rather than a
-- column on the app, so the constraint that keeps it single lives here. Unique rather than an
-- ordinary index: two callers deploying at once each supersede what they can see and neither
-- sees the other's insert, so this is what makes the loser a conflict instead of a second
-- microVM contending for the app's host port.
--
-- Named as the states that are *not* terminal, so a state added later is live unless it says
-- otherwise. Changing that list means rebuilding this index: a partial index decides
-- membership when a row is written, so rows already in it keep the old answer.
CREATE UNIQUE INDEX deployments_live_idx
  ON nibrun.deployments (app_id) WHERE state NOT IN ('superseded', 'failed');

CREATE TRIGGER set_updated_at BEFORE UPDATE ON nibrun.deployments
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();
