ALTER TABLE nibrun.github_trusted_deployment_workflows
  ADD COLUMN current_revision uuid NOT NULL DEFAULT uuidv7();

CREATE FUNCTION nibrun.renew_github_workflow_revision() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.current_revision = uuidv7();
  RETURN NEW;
END;
$$;

CREATE TRIGGER renew_current_revision BEFORE UPDATE ON nibrun.github_trusted_deployment_workflows
  FOR EACH ROW EXECUTE FUNCTION nibrun.renew_github_workflow_revision();

CREATE TABLE nibrun.github_deployment_grants (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  app_id uuid NOT NULL REFERENCES nibrun.apps (id) ON DELETE CASCADE,
  owner_id text NOT NULL,
  workflow_id uuid NOT NULL REFERENCES nibrun.github_trusted_deployment_workflows (id) ON DELETE RESTRICT,
  workflow_revision uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  github_token_jti text NOT NULL CHECK (github_token_jti <> ''),
  github_repository text NOT NULL,
  github_repository_id text NOT NULL,
  github_repository_owner_id text NOT NULL,
  github_workflow_ref text NOT NULL,
  github_ref text NOT NULL,
  github_event_name text NOT NULL,
  github_commit_sha text NOT NULL,
  github_run_id text NOT NULL,
  github_run_attempt text NOT NULL,
  github_environment text,
  github_job_workflow_ref text,
  github_job_workflow_sha text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN nibrun.github_deployment_grants.id IS $c$@type import('#lib/api/identifiers.ts').DeploymentGrantId$c$;
COMMENT ON COLUMN nibrun.github_deployment_grants.app_id IS $c$@type import('@repo/protocol').AppId$c$;
COMMENT ON COLUMN nibrun.github_deployment_grants.owner_id IS $c$@type import('#lib/api/identifiers.ts').OwnerId$c$;
COMMENT ON COLUMN nibrun.github_deployment_grants.workflow_id IS $c$@type import('#lib/api/identifiers.ts').TrustedWorkflowId$c$;
COMMENT ON COLUMN nibrun.github_deployment_grants.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE UNIQUE INDEX github_deployment_grants_token_once_idx
  ON nibrun.github_deployment_grants (app_id, github_token_jti);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON nibrun.github_deployment_grants
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();
