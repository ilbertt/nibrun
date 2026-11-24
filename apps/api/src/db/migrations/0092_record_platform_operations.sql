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

CREATE FUNCTION nibrun.record_platform_deployment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO nibrun.operations (action, client, app_id, deployment_id)
  VALUES ('deployment.requested', 'system', NEW.app_id, NEW.id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER record_platform_deployment AFTER INSERT ON nibrun.deployments
  FOR EACH ROW WHEN (NEW.initiated_by LIKE 'system.%')
  EXECUTE FUNCTION nibrun.record_platform_deployment();
