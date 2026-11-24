CREATE TABLE nibrun.operations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  created_at timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  action text NOT NULL,
  client text NOT NULL,
  actor_user_id text,
  github_token_jti text,
  app_id uuid REFERENCES nibrun.apps (id) ON DELETE RESTRICT,
  host_id uuid REFERENCES nibrun.hosts (id) ON DELETE RESTRICT,
  CONSTRAINT operations_action_check CHECK (action IN (
    'app.created', 'app.updated', 'app.environment.updated', 'app.suspended', 'app.resumed',
    'app.deletion.requested', 'deployment.requested', 'deployment.rollback.requested', 'host.retired'
  )),
  CONSTRAINT operations_client_check CHECK (client IN ('dashboard', 'cli', 'mcp', 'system', 'unknown')),
  CONSTRAINT operations_actor_check CHECK (
    CASE WHEN client = 'system' THEN num_nonnulls(actor_user_id, github_token_jti) = 0
         ELSE num_nonnulls(actor_user_id, github_token_jti) = 1 END
  ),
  CONSTRAINT operations_actor_user_id_check CHECK (btrim(actor_user_id) <> ''),
  CONSTRAINT operations_target_check CHECK (
    CASE WHEN action = 'host.retired' THEN host_id IS NOT NULL AND app_id IS NULL AND client = 'system'
         ELSE app_id IS NOT NULL AND host_id IS NULL END
  ),
  CONSTRAINT operations_github_grant_fkey FOREIGN KEY (app_id, github_token_jti)
    REFERENCES nibrun.github_deployment_grants (app_id, github_token_jti) ON DELETE RESTRICT
);

COMMENT ON COLUMN nibrun.operations.created_at IS
  'Derived from the uuidv7 id; the moment the row was created. @notNull';
COMMENT ON COLUMN nibrun.operations.actor_user_id IS
  $c$The user at the time of the operation. Linking an anonymous account can delete the original auth user. @type import('#lib/api/identifiers.ts').OwnerId$c$;
COMMENT ON COLUMN nibrun.operations.github_token_jti IS
  'The verified workflow grant is identified by its app and GitHub token identifier.';
COMMENT ON COLUMN nibrun.operations.app_id IS $c$@type import('@repo/protocol').AppId$c$;
COMMENT ON COLUMN nibrun.operations.host_id IS $c$@type import('@repo/protocol').HostId$c$;

CREATE INDEX operations_app_id_id_idx ON nibrun.operations (app_id, id) WHERE app_id IS NOT NULL;
CREATE INDEX operations_host_id_id_idx ON nibrun.operations (host_id, id) WHERE host_id IS NOT NULL;

CREATE TRIGGER operations_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON nibrun.operations
  FOR EACH STATEMENT EXECUTE FUNCTION nibrun.refuse_write();
