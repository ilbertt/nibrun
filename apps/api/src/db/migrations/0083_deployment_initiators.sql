ALTER TABLE nibrun.deployments
  ADD COLUMN initiated_by text DEFAULT 'owner',
  ADD CONSTRAINT deployments_initiated_by_check
    CHECK (initiated_by IN ('owner', 'system.host-migration', 'system.storage-migration'));

COMMENT ON COLUMN nibrun.deployments.initiated_by IS
  $c$The owner or platform operation that initiated this deployment. Nullable during rollout; a later migration will require it. @type import('#lib/api/deployment-initiator.ts').DeploymentInitiator$c$;
