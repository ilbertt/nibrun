-- The number a host long-polls against. A counter rather than a hash of what the desired-state
-- query returns, because the question a host asks is "have I read this yet", which a value it
-- can compare against the one it stored answers without the api re-deriving anything.
--
-- One row and no host column: hosts are not modelled, so there is one desired state and every
-- agent that registers is served it. A second host is this table gaining a key and the reads
-- below it gaining a WHERE.
--
-- Bumped only where the *desired* set changes. A host's report writes `deployments.state` too,
-- so a trigger firing on every state change would make report → bump → poll → report a loop
-- the fleet never leaves.

CREATE TABLE nibrun.desired_state (
  singleton  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  generation bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN nibrun.desired_state.singleton IS 'Admits one row and no second, so a single desired state is a constraint rather than a convention.';
COMMENT ON COLUMN nibrun.desired_state.generation IS 'A Postgres bigint, so it arrives as a string; the wire type is a number.';

INSERT INTO nibrun.desired_state DEFAULT VALUES;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON nibrun.desired_state
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();

CREATE FUNCTION nibrun.bump_desired_state() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  UPDATE nibrun.desired_state SET generation = generation + 1;
  RETURN NULL;
END;
$$;

-- A deployment enters the desired set when it is created and leaves it when its state crosses
-- the line `deployments_live_idx` draws. Those states are repeated here rather than shared with
-- that index through a function: an index decides membership when a row is written, so rows
-- already in it would keep answering the old definition after the function changed.
CREATE TRIGGER bump_desired_state_on_insert AFTER INSERT ON nibrun.deployments
  FOR EACH ROW EXECUTE FUNCTION nibrun.bump_desired_state();

CREATE TRIGGER bump_desired_state_on_liveness AFTER UPDATE OF state ON nibrun.deployments
  FOR EACH ROW
  WHEN (
    (OLD.state NOT IN ('superseded', 'failed'))
      IS DISTINCT FROM (NEW.state NOT IN ('superseded', 'failed'))
  )
  EXECUTE FUNCTION nibrun.bump_desired_state();

-- Whether the app runs at all, and what it answers on.
CREATE TRIGGER bump_desired_state AFTER UPDATE OF state ON nibrun.apps
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION nibrun.bump_desired_state();

CREATE TRIGGER bump_desired_state AFTER INSERT OR UPDATE OR DELETE ON nibrun.app_hostnames
  FOR EACH STATEMENT EXECUTE FUNCTION nibrun.bump_desired_state();

-- `app_configs` deliberately has none: a deployment pins the version it was launched with, so a
-- patch reaches a host on the next deploy, and that deploy is an insert the trigger above sees.
