-- What a host says about the microVM a deployment is. Beside the deployment rather than in a
-- table of their own, because one deployment is one microVM: there is never a second row to
-- point at, and a join would only ever find the row it started from.
--
-- None of these reach the public `Deployment` shape. They are here for an operator looking at
-- why an app is not serving, which is a question the api can only answer if it kept the answer.

ALTER TABLE nibrun.deployments
  ADD COLUMN host_port       integer,
  ADD COLUMN guest_ipv4      text,
  ADD COLUMN restart_count   integer NOT NULL DEFAULT 0,
  ADD COLUMN message         text,
  ADD COLUMN started_at      timestamptz,
  ADD COLUMN last_healthy_at timestamptz;

COMMENT ON COLUMN nibrun.deployments.host_port IS $c$@type import('@repo/protocol').HostPort$c$;
COMMENT ON COLUMN nibrun.deployments.guest_ipv4 IS $c$@type import('@repo/protocol').Ipv4Address$c$;
