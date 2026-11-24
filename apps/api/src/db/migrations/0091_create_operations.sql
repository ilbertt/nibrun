CREATE TABLE nibrun.operations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  created_at timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  action text NOT NULL,
  client text NOT NULL,
  github_token_jti text,
  app_id uuid REFERENCES nibrun.apps (id) ON DELETE RESTRICT,
  deployment_id uuid,
  host_id uuid REFERENCES nibrun.hosts (id) ON DELETE RESTRICT,
  CONSTRAINT operations_action_check CHECK (action IN (
    'app.created', 'app.updated', 'app.environment.updated', 'app.suspended', 'app.resumed',
    'app.deletion.requested', 'deployment.requested', 'deployment.rollback.requested', 'host.retired'
  )),
  CONSTRAINT operations_client_check CHECK (client IN ('dashboard', 'cli', 'mcp', 'system', 'unknown')),
  CONSTRAINT operations_system_grant_check CHECK (client <> 'system' OR github_token_jti IS NULL),
  CONSTRAINT operations_deployment_target_check CHECK (
    (deployment_id IS NOT NULL) = (action LIKE 'deployment.%')
  ),
  CONSTRAINT operations_target_check CHECK (
    CASE WHEN action = 'host.retired' THEN host_id IS NOT NULL AND app_id IS NULL AND client = 'system'
         ELSE app_id IS NOT NULL AND host_id IS NULL END
  ),
  CONSTRAINT operations_github_grant_fkey FOREIGN KEY (app_id, github_token_jti)
    REFERENCES nibrun.github_deployment_grants (app_id, github_token_jti) ON DELETE RESTRICT
);

COMMENT ON COLUMN nibrun.operations.created_at IS
  'Derived from the uuidv7 id; the moment the row was created. @notNull';
COMMENT ON COLUMN nibrun.operations.github_token_jti IS
  'The verified workflow grant is identified by its app and GitHub token identifier.';
COMMENT ON COLUMN nibrun.operations.app_id IS $c$@type import('@repo/protocol').AppId$c$;
COMMENT ON COLUMN nibrun.operations.deployment_id IS
  $c$The deployment created by the request, including a rollback. Retained after the app's deployments are purged. @type import('@repo/protocol').DeploymentId$c$;
COMMENT ON COLUMN nibrun.operations.host_id IS $c$@type import('@repo/protocol').HostId$c$;

CREATE INDEX operations_app_id_id_idx ON nibrun.operations (app_id, id) WHERE app_id IS NOT NULL;
CREATE INDEX operations_deployment_id_idx ON nibrun.operations (deployment_id) WHERE deployment_id IS NOT NULL;
CREATE INDEX operations_host_id_id_idx ON nibrun.operations (host_id, id) WHERE host_id IS NOT NULL;

CREATE TRIGGER operations_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON nibrun.operations
  FOR EACH STATEMENT EXECUTE FUNCTION nibrun.refuse_write();

CREATE FUNCTION nibrun.require_operation_deployment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM nibrun.deployments WHERE id = NEW.deployment_id AND app_id = NEW.app_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The operation must reference a deployment of its app'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER require_operation_deployment BEFORE INSERT ON nibrun.operations
  FOR EACH ROW WHEN (NEW.deployment_id IS NOT NULL) EXECUTE FUNCTION nibrun.require_operation_deployment();
