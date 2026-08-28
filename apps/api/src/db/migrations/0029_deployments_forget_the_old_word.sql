-- The other half of 0028, now that every row has been moved off `active`. The CASE that read the
-- old word as the new one goes with it.
--
-- Adding the constraint validates every row already in the table, so this is also what proves the
-- move finished: one still holding `active` fails the migration and the api does not start, rather
-- than starting on a vocabulary it no longer reads.

ALTER TABLE nibrun.deployments
  DROP CONSTRAINT deployments_state_check,
  ADD CONSTRAINT deployments_state_check
    CHECK (state IN ('pending', 'starting', 'running', 'stopped', 'superseded', 'failed'));
