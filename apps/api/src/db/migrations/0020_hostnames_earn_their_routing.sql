-- A hostname is now routable only once the edge can serve it, which 0007 had no way to say.
--
-- A platform hostname could be routed the moment it was minted: the wildcard record and the
-- wildcard certificate already cover it. A brought domain covers neither, and nothing in DNS
-- points at us until its owner makes it — so it has to wait, and something has to hold the
-- answer to whether it still is.
--
-- The CHECK repeats APP_HOSTNAME_STATES from @repo/protocol and nothing compares the two, so
-- adding a state there is also a migration here.
--
-- The default is `pending` rather than `active` because the two failures are not the same size:
-- a hostname that is not served yet is a customer waiting, and one served before it was proved
-- is somebody else's domain answering from our fleet.

-- Added with `active` as the default and re-defaulted to `pending` immediately, which is what
-- backfills the rows already here without this migration writing a row. Everything that predates
-- it is a platform hostname the fleet is already answering for; everything after it is a claim.
ALTER TABLE nibrun.app_hostnames
  ADD COLUMN state text NOT NULL DEFAULT 'active',
  ADD CONSTRAINT app_hostnames_state_check CHECK (state IN ('pending', 'active', 'failed'));

ALTER TABLE nibrun.app_hostnames ALTER COLUMN state SET DEFAULT 'pending';

COMMENT ON COLUMN nibrun.app_hostnames.state IS $c$@type import('@repo/protocol').AppHostnameState$c$;

-- The rendered proxy config is built from this, so the filter below is the whole of what stops a
-- hostname nobody has proved they own from being answered for by the fleet. One condition over
-- both kinds rather than a rule per kind: a platform row is `active` from birth, so there is no
-- second sentence for a mistake to hide in.
CREATE OR REPLACE VIEW nibrun.desired_hostnames AS
  SELECT h.app_id, h.hostname, h.kind
  FROM nibrun.app_hostnames h
  JOIN nibrun.desired_deployments d ON d.app_id = h.app_id
  WHERE h.state = 'active';
