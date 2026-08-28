-- `guest_port` said where the port lives rather than what it is for, and the guest is nibrun's
-- word, not the owner's. It is the port the binary serves HTTP on, which is what every surface
-- now calls it.
--
-- Renaming the base column rewrites how a dependent view reaches it but leaves the view's own
-- column named as it was created, so each one that exposes it is renamed too — otherwise the
-- reading queries would keep the old name while the table no longer has it.

ALTER TABLE nibrun.app_configs RENAME COLUMN guest_port TO http_port;

ALTER TABLE nibrun.app_configs
  RENAME CONSTRAINT app_configs_guest_port_check TO app_configs_http_port_check;

ALTER VIEW nibrun.app_configs_with_environment RENAME COLUMN guest_port TO http_port;

ALTER VIEW nibrun.desired_deployments RENAME COLUMN guest_port TO http_port;

COMMENT ON COLUMN nibrun.app_configs.http_port IS $c$@type import('@repo/protocol').HttpPort$c$;
