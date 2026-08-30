-- How an app is brought up, beside the state that says whether it should be up at all. The two
-- are the same kind of fact — what the owner wants of the app, rather than what a release runs —
-- which is why this is here and not on `app_configs`: a config version is pinned by a deployment
-- and never rewritten, so a policy stored there could only be changed by deploying, and a
-- rollback would replay whichever policy was in force months ago.
--
-- The CHECK repeats APP_ACTIVATIONS from @repo/protocol and nothing compares the two, so adding
-- an activation there is also a migration here.
--
-- `always` is the default and every existing app takes it, which is what they have always done.
-- `idle_timeout_ms` is what an `on-request` app's saving is actually made of: it is the memory
-- a sleeping app is not holding, so the shorter this is the more of the day is reclaimed. The
-- default is minutes rather than an hour because an app visited a few times a day sleeps through
-- almost none of it at an hour, and rather than seconds because whoever arrives after the gap
-- pays a cold boot for it. It is read only for `on-request`, and kept for every app so that
-- flipping the activation is one column rather than two. The floor repeats MIN_IDLE_TIMEOUT_MS
-- from @repo/protocol, which is the cadence the host measures traffic on.
ALTER TABLE nibrun.apps
  ADD COLUMN activation text NOT NULL DEFAULT 'always',
  ADD COLUMN idle_timeout_ms integer NOT NULL DEFAULT 900000,
  ADD CONSTRAINT apps_activation_check CHECK (activation IN ('always', 'on-request')),
  ADD CONSTRAINT apps_idle_timeout_ms_check CHECK (idle_timeout_ms >= 60000);

COMMENT ON COLUMN nibrun.apps.activation IS $c$@type import('@repo/protocol').AppActivation$c$;

-- A suspended app is stopped whatever its activation says, so the two collapse into the one
-- answer a host acts on. `on-request` reaches it only for an app that should be serving, which
-- is what keeps the host from having to reason about a policy it cannot act on.
--
-- Appended last, because CREATE OR REPLACE VIEW may only add columns at the end.
CREATE OR REPLACE VIEW nibrun.desired_deployments AS
  SELECT d.id,
         d.app_id,
         a.state,
         ar.digest, ar.size_bytes, ar.object_key, ar.original_file_name,
         c.http_port, c.args, c.vcpu_count, c.memory_mib,
         c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
         c.health_check_grace_period_ms, c.health_check_healthy_threshold,
         c.health_check_unhealthy_threshold,
         c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
         c.restart_backoff_factor, c.restart_reset_after_ms,
         d.config_id,
         c.has_extra_public_port,
         a.activation, a.idle_timeout_ms
  FROM nibrun.deployments d
  JOIN nibrun.apps a ON a.id = d.app_id
  JOIN nibrun.artifacts ar ON ar.id = d.artifact_id
  JOIN nibrun.app_configs c ON c.id = d.config_id
  WHERE d.state NOT IN ('superseded', 'failed') AND a.state IN ('active', 'suspended');
