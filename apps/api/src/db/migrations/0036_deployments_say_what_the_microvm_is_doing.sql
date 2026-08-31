-- What the host last said about the microVM, beside the state of the release it belongs to. The
-- two were one sentence until `on-request` separated them: a release whose app sleeps between
-- requests is still the release the next visitor reaches, so it stays `running` with no microVM
-- behind it at all. Without somewhere to keep the other half, the owner of an app that is asleep
-- because nobody has visited it is shown one that is running and no reading of anything.
--
-- Null for a row written before hosts said it, and for a deployment no host has reported on yet.
--
-- The CHECK repeats INSTANCE_STATES from @repo/protocol and nothing compares the two, so adding
-- a state there is also a migration here.

ALTER TABLE nibrun.deployments
  ADD COLUMN instance_state text,
  ADD CONSTRAINT deployments_instance_state_check
    CHECK (instance_state IN ('pending', 'starting', 'running', 'unhealthy', 'stopping',
                              'stopped', 'idle', 'failed'));

COMMENT ON COLUMN nibrun.deployments.instance_state IS $c$@type import('@repo/protocol').InstanceState$c$;
