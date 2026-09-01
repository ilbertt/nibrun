-- A failed release left desired state entirely, and a host acts on that list by forgetting
-- everything not on it — including the app's hostnames, which are rendered from the records it
-- keeps. So one microVM going down took the app off the proxy: its platform hostname fell
-- through to the wildcard's 404, and a brought domain, which no site block and therefore no
-- certificate was left for, failed the handshake and answered `525`.
--
-- Being unable to run an app is not the same as not being answerable for it. `desired_volumes`
-- has said so since it was written — an app whose every deployment failed keeps its data — and
-- this is the same sentence about the other thing a release leaves behind.
--
-- The deployment stays `failed` throughout: `applyReport` writes nothing to a terminal row, so
-- what the owner is told does not move because the host was told to go on answering.

-- `deployments_live_idx` admits one live row per app but nothing bounds the failed ones, and both
-- `hostnamesByApp` and the host's planner key on the app — so a second row for one app is a
-- duplicated hostname and two plans for the same microVM. The `NOT EXISTS` is what keeps the one
-- row per app those already assume: only the newest release an app still has stands, so a live
-- one wins and the last failure stands in when there is none. `supersedeLive` leaves a failed row
-- alone, which is the whole reason there can be more than one to choose between.
--
-- Written as a correlated `NOT EXISTS` rather than `DISTINCT ON`, which reads better and means
-- the same thing here: `bun-sqlgen` cannot trace a column through the latter, and every one of
-- them silently loses its base type and its NOT NULL.
--
-- Appended last, because CREATE OR REPLACE VIEW may only add columns at the end.
CREATE OR REPLACE VIEW nibrun.desired_deployments AS
  SELECT
         d.id,
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
         a.activation, a.idle_timeout_ms,
         d.state AS deployment_state
  FROM nibrun.deployments d
  JOIN nibrun.apps a ON a.id = d.app_id
  JOIN nibrun.artifacts ar ON ar.id = d.artifact_id
  JOIN nibrun.app_configs c ON c.id = d.config_id
  WHERE d.state <> 'superseded'
    AND a.state IN ('active', 'suspended')
    AND NOT EXISTS (
      SELECT 1 FROM nibrun.deployments newer
      WHERE newer.app_id = d.app_id AND newer.state <> 'superseded' AND newer.id > d.id
    );

COMMENT ON COLUMN nibrun.desired_deployments.deployment_state IS
  'The release''s own state, beside the app''s. A host reads it to tell a release it should run from one it is only answering for.';
