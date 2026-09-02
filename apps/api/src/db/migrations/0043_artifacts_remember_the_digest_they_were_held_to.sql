-- The digest a url was promised to serve, kept beside the url itself.
--
-- Not the same number as `digest`, and the two are only equal by coincidence. `digest` is taken
-- from the executable that ends up stored; this is taken from the file the url served, which for
-- a release published as a `.tar.gz` is the archive. That is the form a checksum is written down
-- in — a `checksums.txt` beside a zip is the zip's — so it is the only one a link can carry and
-- the only one two links for the same release agree on.
--
-- Null for every upload, for every url nobody said a digest for, and for every url that carried
-- credentials. The first two never had one; the last is a download somebody reached with a
-- password, and a digest is enough to ask for the bytes it names.

ALTER TABLE nibrun.artifacts
  ADD COLUMN source_digest text;

COMMENT ON COLUMN nibrun.artifacts.source_digest IS $c$The digest the url's own download was held to, which for an archive is the archive's. @type import('@repo/protocol').Sha256Digest$c$;

-- What a url served once, and need not serve again.
--
-- A view rather than a table: every column of it already belongs to the artifact, and a second
-- copy is a second thing to write, to expire, and to be wrong. Membership is the whole of being
-- cached, which is the same sentence as the bytes being worth keeping.
--
-- `activated_at IS NOT NULL` is what a deployment that worked leaves behind, so nothing reaches
-- this view on the strength of having been fetched. A binary that was pulled, stored and never
-- got a microVM to answer a health check is one nobody has shown is worth handing to the next
-- person who asks for it.
--
-- `live_apps` is what keeps the row honest about its object. The bytes are removed when the last
-- app naming them is purged, so a row here that outlived them would send a fetch nowhere — and an
-- app on its way out stops vouching for its binary before that can happen.
CREATE VIEW nibrun.cached_binaries AS
  SELECT ar.source_digest,
         ar.digest,
         ar.size_bytes,
         ar.object_key,
         ar.original_file_name
  FROM nibrun.artifacts ar
  JOIN nibrun.deployments d ON d.artifact_id = ar.id
  JOIN nibrun.live_apps a ON a.id = ar.app_id
  WHERE ar.source_digest IS NOT NULL
    AND ar.object_key IS NOT NULL
    AND d.activated_at IS NOT NULL;

-- The one question ever asked of the column, and partial because the rows worth looking at are
-- the few that were fetched from a url somebody vouched for.
CREATE INDEX artifacts_source_digest_idx ON nibrun.artifacts (source_digest)
  WHERE source_digest IS NOT NULL;

-- Read from the artifact's side, so the join above starts at the one row a digest names rather
-- than at every deployment that ever succeeded.
CREATE INDEX deployments_activated_artifact_idx ON nibrun.deployments (artifact_id)
  WHERE activated_at IS NOT NULL;

-- A view carries none of the column comments its table columns have, so the types the rest of
-- this schema is read through are said again here rather than degrading to `text` at the one
-- place a binary is chosen without being fetched.
COMMENT ON COLUMN nibrun.cached_binaries.source_digest IS $c$@type import('@repo/protocol').Sha256Digest @notNull$c$;
COMMENT ON COLUMN nibrun.cached_binaries.digest IS $c$@type import('@repo/protocol').Sha256Digest @notNull$c$;
COMMENT ON COLUMN nibrun.cached_binaries.size_bytes IS 'A Postgres bigint, so it arrives as a string; the wire type is a number. @notNull';
COMMENT ON COLUMN nibrun.cached_binaries.object_key IS $c$@type import('@repo/protocol').ObjectKey @notNull$c$;
COMMENT ON COLUMN nibrun.cached_binaries.original_file_name IS $c$@type import('@repo/protocol').Filename @notNull$c$;
