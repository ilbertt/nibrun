ALTER TABLE nibrun.deployments ALTER COLUMN host_id SET NOT NULL;

COMMENT ON COLUMN nibrun.deployments.host_id IS
  $c$The immutable execution host assigned when this deployment is created. @type import('@repo/protocol').HostId$c$;

COMMENT ON COLUMN nibrun.latest_app_deployments.host_id IS
  'The latest execution always has an assigned host. @notNull';

CREATE OR REPLACE VIEW nibrun.app_hosts AS
  SELECT app_id, deployment_id, host_id FROM nibrun.latest_app_deployments;
