-- 0020 gave a hostname a state to wait in. This is what the waiting is on: a brought domain has
-- to exist at the edge before anything can serve it, and the owner has to be told which record
-- to place before the edge will issue a certificate for it.
--
-- Both are absent on a platform hostname. The wildcard record and the wildcard certificate
-- already cover those, so there is nothing at the edge naming one and nothing to ask its owner.

ALTER TABLE nibrun.app_hostnames
  ADD COLUMN cloudflare_id text,
  ADD COLUMN dcv_target    text;

COMMENT ON COLUMN nibrun.app_hostnames.cloudflare_id IS 'The custom hostname this row is projected onto at the edge. Absent for a platform hostname, which the wildcard already covers.';
COMMENT ON COLUMN nibrun.app_hostnames.dcv_target IS 'What the owner points _acme-challenge at, so the edge can renew the certificate without asking them again. Absent for a platform hostname.';

-- Read once per pass over the rows still waiting, and partial because those are always the few.
CREATE INDEX app_hostnames_pending_idx ON nibrun.app_hostnames (id) WHERE state = 'pending';
