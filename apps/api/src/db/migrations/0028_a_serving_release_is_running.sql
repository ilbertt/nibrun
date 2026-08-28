-- One word for one thing: a host has always called the microVM `running`, and the api called the
-- release it is `active` — a translation with nothing on either side of it.
--
-- Both spellings, because a migration here may not rewrite rows and the ones already saying
-- `active` outlive this file. They are moved by hand once this is deployed, and a follow-up
-- migration drops the old word from the check. Until that UPDATE lands, a host report naming one
-- of those releases fails and retries — nothing left in the api understands `active`.

ALTER TABLE nibrun.deployments
  DROP CONSTRAINT deployments_state_check,
  ADD CONSTRAINT deployments_state_check
    CHECK (
      state IN ('pending', 'starting', 'active', 'running', 'stopped', 'superseded', 'failed')
    );
