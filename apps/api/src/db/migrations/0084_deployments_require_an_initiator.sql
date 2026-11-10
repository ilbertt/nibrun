ALTER TABLE nibrun.deployments ALTER COLUMN initiated_by SET NOT NULL;

COMMENT ON COLUMN nibrun.deployments.initiated_by IS
  $c$The owner or platform operation that initiated this deployment. @type import('#lib/api/deployment-initiator.ts').DeploymentInitiator$c$;
