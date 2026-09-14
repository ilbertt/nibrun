-- 0020 gave a hostname a state to wait in and 0021 something to wait on. Neither says why the
-- wait is still going: the edge answers a hostname's routing and its certificate separately,
-- and each of them with its own reason, which until now was read on every pass and dropped.
--
-- The reasons are the edge's own words. They name the record the owner has yet to place, and
-- when there are none the two statuses say whose turn it is — a certificate `pending_issuance`
-- is the edge's, a hostname `pending` with no error is DNS that has not propagated yet.
--
-- Written only when they change, so `updated_at` marks the last time the edge said something
-- new rather than the last time it was asked.

ALTER TABLE nibrun.app_hostnames
  ADD COLUMN edge_status     text,
  ADD COLUMN edge_ssl_status text,
  ADD COLUMN edge_errors     text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN nibrun.app_hostnames.edge_status IS 'The routing half as the edge last reported it, in its vocabulary. Absent for a platform hostname, and until the edge has been asked.';
COMMENT ON COLUMN nibrun.app_hostnames.edge_ssl_status IS 'The certificate half as the edge last reported it, in its vocabulary. Absent for a platform hostname, and until the edge has been asked.';
COMMENT ON COLUMN nibrun.app_hostnames.edge_errors IS 'What the edge says is still missing, in its own words. Empty when nothing is, which is also what a platform hostname carries.';
