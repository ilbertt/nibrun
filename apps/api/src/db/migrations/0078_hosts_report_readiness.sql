ALTER TABLE nibrun.hosts
  ADD COLUMN reported_state text NOT NULL DEFAULT 'registering',
  ADD COLUMN last_seen_at timestamptz,
  ADD CONSTRAINT hosts_reported_state_check
    CHECK (reported_state IN ('registering', 'ready', 'draining', 'unreachable'));

COMMENT ON COLUMN nibrun.hosts.reported_state IS
  $c$@type import('@repo/protocol').HostState$c$;
COMMENT ON COLUMN nibrun.hosts.last_seen_at IS
  'When the control plane last received a report from this host.';
