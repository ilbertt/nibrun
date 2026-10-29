COMMENT ON COLUMN nibrun.app_hosts.app_id IS 'The app whose latest execution owns the assignment. @notNull';
COMMENT ON COLUMN nibrun.app_hosts.deployment_id IS 'The latest execution, including while its app is stopped or failed. @notNull';
