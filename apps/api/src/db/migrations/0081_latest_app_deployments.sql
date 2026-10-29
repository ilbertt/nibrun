CREATE VIEW nibrun.latest_app_deployments AS
  SELECT d.app_id, d.id AS deployment_id, d.host_id
  FROM nibrun.deployments d
  WHERE NOT EXISTS (
    SELECT 1 FROM nibrun.deployments newer
    WHERE newer.app_id = d.app_id AND newer.id > d.id
  );

COMMENT ON COLUMN nibrun.latest_app_deployments.app_id IS 'The app that requested this execution. @notNull';
COMMENT ON COLUMN nibrun.latest_app_deployments.deployment_id IS 'The latest requested execution for this app. @notNull';

CREATE OR REPLACE VIEW nibrun.app_hosts AS
  SELECT app_id, deployment_id, host_id
  FROM nibrun.latest_app_deployments
  WHERE host_id IS NOT NULL;
