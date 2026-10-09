ALTER TABLE nibrun.github_trusted_deployment_workflows
  ADD COLUMN deleted_at timestamptz,
  DROP CONSTRAINT github_trusted_deployment_workflows_app_id_key;

CREATE UNIQUE INDEX github_trusted_deployment_workflows_live_app_idx
  ON nibrun.github_trusted_deployment_workflows (app_id) WHERE deleted_at IS NULL;

CREATE FUNCTION nibrun.refuse_github_workflow_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Trusted GitHub workflows must be soft-deleted.';
END;
$$;

CREATE TRIGGER github_trusted_workflows_refuse_delete
  BEFORE DELETE ON nibrun.github_trusted_deployment_workflows
  FOR EACH ROW EXECUTE FUNCTION nibrun.refuse_github_workflow_delete();
