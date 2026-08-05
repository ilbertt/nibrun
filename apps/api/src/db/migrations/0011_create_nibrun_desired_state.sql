-- The number the agent long-polls against. It echoes back the one it converged on, and a poll
-- naming the current value is answered `unchanged`, so anything a host is told about has to
-- move this or the host never re-reads.
--
-- Bumped by triggers on the tables desired state is read from rather than by whichever service
-- happened to write the row: a service that forgets is a deploy that silently never happens.
--
-- One row, because there is one app host. A table rather than a sequence because this is read
-- on every poll, and a sequence cannot answer what its current value is without either
-- consuming one or reading `is_called`.

CREATE TABLE nibrun.desired_state (
  singleton  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  generation bigint NOT NULL DEFAULT 0
);

COMMENT ON COLUMN nibrun.desired_state.generation IS 'A Postgres bigint, so it arrives as a string; the wire type is a number.';

INSERT INTO nibrun.desired_state DEFAULT VALUES;

CREATE FUNCTION nibrun.bump_desired_state_generation() RETURNS trigger AS $$
BEGIN
  UPDATE nibrun.desired_state SET generation = generation + 1;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Only what a host reads. Everything else a report writes — the port, the addresses, the
-- restart count — is deliberately absent.
CREATE TRIGGER deployments_reach_the_host
  AFTER INSERT OR DELETE ON nibrun.deployments
  FOR EACH ROW EXECUTE FUNCTION nibrun.bump_desired_state_generation();

-- A report moves `state` too, so this fires on the liveness the state implies rather than on
-- the state itself: `starting` becoming `active` is the host telling us what it already knows,
-- and answering that with a new generation would have it poll, find nothing, and report again.
CREATE TRIGGER deployments_liveness_reaches_the_host
  AFTER UPDATE OF state ON nibrun.deployments
  FOR EACH ROW
  WHEN (
    (OLD.state IN ('superseded', 'failed')) IS DISTINCT FROM (NEW.state IN ('superseded', 'failed'))
  )
  EXECUTE FUNCTION nibrun.bump_desired_state_generation();

-- An app's config and its hostnames travel inside desired state, so editing either is a change
-- the host has to be told about. `app_configs` is append-only, so a new version is an insert.
CREATE TRIGGER app_configs_reach_the_host
  AFTER INSERT ON nibrun.app_configs
  FOR EACH ROW EXECUTE FUNCTION nibrun.bump_desired_state_generation();

CREATE TRIGGER app_hostnames_reach_the_host
  AFTER INSERT OR UPDATE OR DELETE ON nibrun.app_hostnames
  FOR EACH ROW EXECUTE FUNCTION nibrun.bump_desired_state_generation();

-- Suspending an app stops its microVM and deleting one takes its filesystem away, so the state
-- an app is in is part of what a host is told.
CREATE TRIGGER apps_state_reaches_the_host
  AFTER UPDATE OF state ON nibrun.apps
  FOR EACH ROW
  WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION nibrun.bump_desired_state_generation();
