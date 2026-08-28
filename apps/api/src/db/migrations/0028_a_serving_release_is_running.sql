-- One word for one thing: a host has always called the microVM `running`, and the api called the
-- release it is `active` — a translation with nothing on either side of it.
--
-- Both spellings, because a migration here may not rewrite rows and the ones already saying
-- `active` outlive this file. Until they are moved by hand, the three queries that read a release
-- back carry a CASE that reads the old word as the new one; a follow-up migration drops `active`
-- from this check along with them.

ALTER TABLE nibrun.deployments
  DROP CONSTRAINT deployments_state_check,
  ADD CONSTRAINT deployments_state_check
    CHECK (
      state IN ('pending', 'starting', 'active', 'running', 'stopped', 'superseded', 'failed')
    );
