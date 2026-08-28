-- An app that asked for a public port besides HTTP is reached at an address and a port neither
-- end could work out: the address belongs to the relay in front of the fleet, and the port to the
-- slot the host gave the app. The host is the only party holding both, so it reports them and
-- they land here beside the rest of what it says about the microVM.
--
-- Null for an app that asked for no such port, and until the first report of one that did.

ALTER TABLE nibrun.deployments
  ADD COLUMN public_ipv4 text,
  ADD COLUMN extra_public_port integer;

ALTER TABLE nibrun.deployments
  ADD CONSTRAINT deployments_extra_public_port_check
  CHECK (extra_public_port BETWEEN 1 AND 65535);

COMMENT ON COLUMN nibrun.deployments.public_ipv4 IS $c$@type import('@repo/protocol').Ipv4Address$c$;
COMMENT ON COLUMN nibrun.deployments.extra_public_port IS $c$@type import('@repo/protocol').HostPort$c$;
