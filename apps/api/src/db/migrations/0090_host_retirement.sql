ALTER TABLE nibrun.hosts
  ADD COLUMN retired_at timestamptz,
  ADD CONSTRAINT hosts_retired_at_finite
    CHECK (retired_at IS NULL OR isfinite(retired_at)),
  ADD COLUMN state text GENERATED ALWAYS AS (
    CASE WHEN retired_at IS NOT NULL THEN 'retired' ELSE reported_state END
  ) VIRTUAL;

COMMENT ON COLUMN nibrun.hosts.retired_at IS
  'Operator-owned retirement timestamp. Agent reports cannot clear it.';
COMMENT ON COLUMN nibrun.hosts.state IS
  $c$The effective host state, including operator retirement. @notNull @type import('#lib/api/host.ts').HostState$c$;

CREATE FUNCTION nibrun.require_active_deployment_host() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  host_retired_at timestamptz;
BEGIN
  SELECT retired_at INTO host_retired_at
  FROM nibrun.hosts WHERE id = NEW.host_id
  FOR SHARE;

  IF host_retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'A retired host cannot receive a new deployment'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER require_active_deployment_host BEFORE INSERT ON nibrun.deployments
  FOR EACH ROW EXECUTE FUNCTION nibrun.require_active_deployment_host();

CREATE FUNCTION nibrun.preserve_host_retirement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
    RAISE EXCEPTION 'Host retirement cannot be changed or cleared'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER preserve_host_retirement BEFORE UPDATE OF retired_at ON nibrun.hosts
  FOR EACH ROW EXECUTE FUNCTION nibrun.preserve_host_retirement();
