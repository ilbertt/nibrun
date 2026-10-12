ALTER TABLE nibrun.github_deployment_grants
  ADD CONSTRAINT github_deployment_grants_app_id_id_key UNIQUE (app_id, id);

ALTER TABLE nibrun.artifacts
  ADD COLUMN github_deployment_grant_id uuid,
  ADD CONSTRAINT artifacts_github_deployment_grant_fk
    FOREIGN KEY (app_id, github_deployment_grant_id)
    REFERENCES nibrun.github_deployment_grants (app_id, id);

COMMENT ON COLUMN nibrun.artifacts.github_deployment_grant_id IS $c$@type import('#lib/api/identifiers.ts').DeploymentGrantId$c$;

CREATE INDEX artifacts_github_deployment_grant_idx
  ON nibrun.artifacts (app_id, github_deployment_grant_id)
  WHERE github_deployment_grant_id IS NOT NULL;
