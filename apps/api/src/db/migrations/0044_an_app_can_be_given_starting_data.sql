-- An archive an owner uploaded, which an app's filesystem can be created holding.
--
-- A noun with no notion of use. There is no `kind`, no `mode` and nothing here about what the
-- archive is for: a deployment says that by naming this row, exactly as it says which binary to
-- run by naming an artifact. Whoever needs a second thing to do with an uploaded archive — an
-- overwrite of a filesystem that already exists, say — adds it where the asking happens rather
-- than as a flag here.
--
-- Not a column on `artifacts` and not a key in that bucket. Its `object_key` is documented as a
-- key within ARTIFACTS_BUCKET and its keys are content-addressed, which is exactly wrong for this:
-- one key per row, so two owners uploading identical bytes never share an object and expiring one
-- can never take the other's away. That table's service exists to reject anything that is not a
-- Linux executable, and for an artifact an archive is a wrapper to unwrap and discard, where here
-- the archive is the payload.
--
-- The row is written before its bytes exist, as `artifacts` has been since 0017, and for the same
-- reason: the upload does not pass through the api, so the row is what it is addressed by. What
-- the bytes decide stays absent until they have been read. `digest IS NULL` is the whole of "still
-- coming" — no state column, because a row is complete when what completes it is present.

CREATE TABLE nibrun.imports (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  app_id             uuid NOT NULL REFERENCES nibrun.apps (id) ON DELETE CASCADE,
  digest             text,
  size_bytes         bigint,
  object_key         text,
  original_file_name text NOT NULL,
  created_at         timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE nibrun.imports IS 'An uploaded archive an app can be given as its starting data. What it is used for is said by whatever names it.';
COMMENT ON COLUMN nibrun.imports.id IS $c$@type import('@repo/protocol').ImportId$c$;
COMMENT ON COLUMN nibrun.imports.app_id IS $c$@type import('@repo/protocol').AppId$c$;
COMMENT ON COLUMN nibrun.imports.digest IS $c$Absent until the api has hashed the uploaded object; its presence is what makes the row usable. @type import('@repo/protocol').Sha256Digest$c$;
COMMENT ON COLUMN nibrun.imports.size_bytes IS 'Counted off the uploaded bytes, so absent until they are there. A Postgres bigint, so it arrives as a string; the wire type is a number.';
COMMENT ON COLUMN nibrun.imports.object_key IS $c$Where the bytes are, present exactly while they are: absent before the upload has been read back, and absent again once the archive can no longer be used. Key within IMPORTS_BUCKET; which bucket is deploy configuration. @type import('@repo/protocol').ObjectKey$c$;
COMMENT ON COLUMN nibrun.imports.original_file_name IS $c$The name the archive was uploaded under; the key it lands under carries none. @type import('@repo/protocol').Filename$c$;
COMMENT ON COLUMN nibrun.imports.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE INDEX imports_app_id_idx ON nibrun.imports (app_id);

-- An upload nobody ever completes leaves this row behind, and the bucket rule that expires the
-- object cannot reach it. Partial, because the rows worth sweeping are always the few still
-- pending rather than the many that are done.
CREATE INDEX imports_pending_idx ON nibrun.imports (id) WHERE digest IS NULL;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON nibrun.imports
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();

-- An app whose filesystem is gone still has archives sitting in a bucket, and each one is an
-- owner's whole dataset in the clear. The purge is driven off what is still there, so this is what
-- makes it look.
--
-- Appended last, because CREATE OR REPLACE VIEW may only add columns at the end — there are none
-- to add here, so this is the same shape said again with one more thing to look for.
CREATE OR REPLACE VIEW nibrun.purgeable_apps AS
  SELECT a.id AS app_id
  FROM nibrun.apps a
  WHERE a.state = 'deleted'
    AND (EXISTS (SELECT 1 FROM nibrun.artifacts ar WHERE ar.app_id = a.id)
      OR EXISTS (SELECT 1 FROM nibrun.exports e WHERE e.app_id = a.id)
      OR EXISTS (SELECT 1 FROM nibrun.app_hostnames h WHERE h.app_id = a.id)
      OR EXISTS (SELECT 1 FROM nibrun.imports im WHERE im.app_id = a.id));
