ALTER TABLE nibrun.deployments
  ADD COLUMN github_deployment_grant_id uuid
    REFERENCES nibrun.github_deployment_grants (id) ON DELETE RESTRICT;

COMMENT ON COLUMN nibrun.deployments.github_deployment_grant_id IS
  $c$The verified GitHub grant that created this deployment. @type import('#lib/api/identifiers.ts').DeploymentGrantId$c$;

CREATE INDEX deployments_github_deployment_grant_id_idx
  ON nibrun.deployments (github_deployment_grant_id)
  WHERE github_deployment_grant_id IS NOT NULL;
