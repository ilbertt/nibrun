-- A platform hostname is minted once when the app is created and never recomputed, so changing
-- APP_HOST_DOMAIN leaves every existing row naming the domain it was minted under. The rendered
-- proxy config is built from these rows, which is why the domain moves here rather than in config
-- alone.
--
-- Both domains are named literally, so this matches nothing in development or CI, where the app
-- domain has never been either of them. The `kind` guard is what keeps a brought domain out of a
-- rewrite that has no business touching one.

UPDATE nibrun.app_hostnames
SET hostname = left(hostname, length(hostname) - length('.canister.site')) || '.nibrun.app'
WHERE kind = 'platform'
  AND hostname LIKE '%.canister.site';
