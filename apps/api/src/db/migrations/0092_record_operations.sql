CREATE FUNCTION nibrun.operation_client() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('nibrun.operation_client', true), '');
$$;

CREATE FUNCTION nibrun.record_app_operation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  action text;
  config_action text := NULLIF(current_setting('nibrun.app_config_action', true), '');
BEGIN
  IF config_action IS NOT NULL THEN
    IF config_action NOT IN ('app.updated', 'app.environment.updated') THEN
      RAISE EXCEPTION 'Invalid app config action: %', config_action;
    END IF;
    -- The hint describes one app patch; a later write in this transaction has its own meaning.
    PERFORM set_config('nibrun.app_config_action', '', true);
  END IF;
  IF TG_OP = 'INSERT' THEN
    action := 'app.created';
  ELSIF OLD.state IS DISTINCT FROM NEW.state THEN
    action := CASE NEW.state
      WHEN 'active' THEN 'app.resumed'
      WHEN 'suspended' THEN 'app.suspended'
      WHEN 'deleting' THEN 'app.deletion.requested'
      ELSE NULL
    END;
  ELSIF OLD.name IS DISTINCT FROM NEW.name THEN
    action := 'app.updated';
  ELSE
    action := config_action;
  END IF;

  IF action IS NOT NULL THEN
    INSERT INTO nibrun.operations (action, client, app_id)
    VALUES (action, nibrun.operation_client(), NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER record_app_operation AFTER INSERT OR UPDATE OF name, state ON nibrun.apps
  FOR EACH ROW WHEN (nibrun.operation_client() IS NOT NULL)
  EXECUTE FUNCTION nibrun.record_app_operation();

CREATE FUNCTION nibrun.record_deployment_operation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO nibrun.operations (action, client, app_id, deployment_id)
  VALUES (
    CASE WHEN NEW.rollback_of_deployment_id IS NULL THEN 'deployment.requested' ELSE 'deployment.rollback.requested' END,
    CASE WHEN NEW.initiated_by LIKE 'system.%' THEN 'system' ELSE nibrun.operation_client() END,
    NEW.app_id, NEW.id
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER record_deployment_operation AFTER INSERT ON nibrun.deployments
  FOR EACH ROW WHEN (NEW.initiated_by LIKE 'system.%' OR nibrun.operation_client() IS NOT NULL)
  EXECUTE FUNCTION nibrun.record_deployment_operation();

CREATE FUNCTION nibrun.record_host_retirement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO nibrun.operations (action, client, host_id) VALUES ('host.retired', 'system', NEW.id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER record_host_retirement AFTER UPDATE OF retired_at ON nibrun.hosts
  FOR EACH ROW WHEN (OLD.retired_at IS NULL AND NEW.retired_at IS NOT NULL)
  EXECUTE FUNCTION nibrun.record_host_retirement();
