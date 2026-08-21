-- A suspended app's release is neither serving nor over. `deployments_live_idx` and every view
-- that reads this column name the terminal states rather than the live ones, so a state added
-- here is live without touching any of them — which is what keeps a stopped release in desired
-- state, and so resumable onto the microVM it left.

ALTER TABLE nibrun.deployments
  DROP CONSTRAINT deployments_state_check,
  ADD CONSTRAINT deployments_state_check
    CHECK (state IN ('pending', 'starting', 'active', 'stopped', 'superseded', 'failed'));
