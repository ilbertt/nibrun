CREATE TABLE nibrun.hosts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  origin_id text NOT NULL UNIQUE CHECK (length(origin_id) > 0),
  created_at timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN nibrun.hosts.id IS
  $c$The canonical identity assigned by the control plane. @type import('@repo/protocol').HostId$c$;
COMMENT ON COLUMN nibrun.hosts.origin_id IS
  'The external identity first presented when the host registered.';
COMMENT ON COLUMN nibrun.hosts.created_at IS
  'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON nibrun.hosts
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();

ALTER TABLE nibrun.deployments
  ADD COLUMN host_id uuid REFERENCES nibrun.hosts (id) ON DELETE RESTRICT;

COMMENT ON COLUMN nibrun.deployments.host_id IS
  $c$The host assigned to this execution. Null until an existing deployment is adopted or a new one is placed. @type import('@repo/protocol').HostId$c$;

CREATE INDEX deployments_host_id_idx ON nibrun.deployments (host_id);

CREATE FUNCTION nibrun.preserve_deployment_host() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.host_id IS NOT NULL AND NEW.host_id IS DISTINCT FROM OLD.host_id THEN
    RAISE EXCEPTION 'Moving a deployment to another host requires a new deployment'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'deployments_host_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER preserve_deployment_host BEFORE UPDATE OF host_id ON nibrun.deployments
  FOR EACH ROW EXECUTE FUNCTION nibrun.preserve_deployment_host();
