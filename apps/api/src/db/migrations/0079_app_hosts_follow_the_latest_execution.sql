CREATE VIEW nibrun.app_hosts AS
  SELECT d.app_id, d.id AS deployment_id, d.host_id
  FROM nibrun.deployments d
  WHERE d.host_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM nibrun.deployments newer
      WHERE newer.app_id = d.app_id AND newer.id > d.id
    );

COMMENT ON COLUMN nibrun.app_hosts.host_id IS
  'An app keeps its last execution host while stopped, failed or awaiting volume deletion. @notNull';
