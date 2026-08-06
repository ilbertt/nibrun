-- What a host should be running, as relations rather than as a query written out wherever
-- something reads it. The generation below is derived from exactly these rows, so it cannot
-- disagree with what the api serves and there is nothing to keep in step by hand.

CREATE VIEW nibrun.desired_deployments AS
  SELECT d.id,
         d.app_id,
         a.state,
         ar.digest, ar.size_bytes, ar.object_key, ar.original_file_name,
         c.guest_port, c.args, c.vcpu_count, c.memory_mib,
         c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
         c.health_check_grace_period_ms, c.health_check_healthy_threshold,
         c.health_check_unhealthy_threshold,
         c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
         c.restart_backoff_factor, c.restart_reset_after_ms
  FROM nibrun.deployments d
  JOIN nibrun.apps a ON a.id = d.app_id
  JOIN nibrun.artifacts ar ON ar.id = d.artifact_id
  JOIN nibrun.app_configs c ON c.id = d.config_id
  -- A deleted app is left out rather than told its volume is `absent`: the list of instances is
  -- authoritative so the microVM stops, and removing a filesystem is a deliberate `absent` that
  -- belongs to deleting the app.
  WHERE d.state NOT IN ('superseded', 'failed') AND a.state IN ('active', 'suspended');

CREATE VIEW nibrun.desired_hostnames AS
  SELECT h.app_id, h.hostname, h.kind
  FROM nibrun.app_hostnames h
  JOIN nibrun.desired_deployments d ON d.app_id = h.app_id;

-- The number a host long-polls against: what it has, or something else.
--
-- A fingerprint of the rows above rather than a counter something bumps. A counter has to be
-- told what changes desired state, which is a second definition of it — one that goes quietly
-- wrong the day a column joins the views and nothing bumps for it, leaving hosts converged on
-- state they never received. This cannot: it is computed from the rows themselves.
--
-- Not monotonic, and nothing needs it to be. A host stores the number and asks whether it still
-- holds; both ends only ever compare it for equality.
--
-- Masked to the largest integer JSON carries exactly, which also drops the sign. A bigint, so it
-- arrives as a string; the wire type is a number.
CREATE VIEW nibrun.desired_state AS
  SELECT COALESCE(hashtextextended(string_agg(row, E'\n' ORDER BY row), 0), 0)
           & 9007199254740991 AS generation
  FROM (
    SELECT d::text AS row FROM nibrun.desired_deployments d
    UNION ALL
    SELECT h::text FROM nibrun.desired_hostnames h
  ) rows;
