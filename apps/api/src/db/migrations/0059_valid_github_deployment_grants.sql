CREATE VIEW nibrun.valid_github_deployment_grants AS
  SELECT g.*
  FROM nibrun.github_deployment_grants g
  JOIN nibrun.live_apps a ON a.id = g.app_id AND a.owner_id = g.owner_id
  JOIN nibrun.github_trusted_deployment_workflows w
    ON w.id = g.workflow_id AND w.app_id = g.app_id
    AND w.current_revision = g.workflow_revision AND w.deleted_at IS NULL
  WHERE g.expires_at > statement_timestamp();

COMMENT ON COLUMN nibrun.valid_github_deployment_grants.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

