-- One word for one thing: a host has always called the microVM `running`, and the api called the
-- release it is `active` — a translation with nothing on either side of it.
--
-- Both spellings, because a migration here may not rewrite rows and the ones already saying
-- `active` outlive this file. They are moved by hand once this is deployed, and a follow-up
-- migration drops the old word from the check. Nothing left in the api understands `active` and a
-- report is one transaction, so until that UPDATE runs one such release fails the whole report its
-- host sends — and every app on that host stops moving with it.

ALTER TABLE nibrun.deployments
  DROP CONSTRAINT deployments_state_check,
  ADD CONSTRAINT deployments_state_check
    CHECK (
      state IN ('pending', 'starting', 'active', 'running', 'stopped', 'superseded', 'failed')
    );
