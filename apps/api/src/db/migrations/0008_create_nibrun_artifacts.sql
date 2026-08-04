-- The digest is the artifact's identity as far as a host is concerned: the agent re-hashes
-- the bytes it pulls and refuses on a mismatch. The key is only where the bytes live, so it
-- is the api that must hash what it stored rather than trust what an uploader claimed.
--
-- Not unique on (app_id, digest): the object key is content-addressed, so the same binary
-- uploaded twice writes the same object under two rows. The rows differ, the bytes do not,
-- and collapsing them would lose the second upload's own history.
--
-- No state column: the row is inserted once the bytes are stored, so an artifact that exists
-- is one whose object is readable. A row that could name absent bytes is not representable.

CREATE TABLE nibrun.artifacts (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  app_id             uuid NOT NULL REFERENCES nibrun.apps (id) ON DELETE CASCADE,
  digest             text NOT NULL,
  size_bytes         bigint NOT NULL,
  object_key         text NOT NULL,
  original_file_name text NOT NULL,
  created_at         timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN nibrun.artifacts.id IS $c$@type import('@repo/protocol').ArtifactId$c$;
COMMENT ON COLUMN nibrun.artifacts.app_id IS $c$@type import('@repo/protocol').AppId$c$;
COMMENT ON COLUMN nibrun.artifacts.digest IS $c$@type import('@repo/protocol').Sha256Digest$c$;
COMMENT ON COLUMN nibrun.artifacts.size_bytes IS 'A Postgres bigint, so it arrives as a string; the wire type is a number.';
COMMENT ON COLUMN nibrun.artifacts.object_key IS $c$Key within ARTIFACTS_BUCKET; which bucket is deploy configuration. @type import('@repo/protocol').ObjectKey$c$;
COMMENT ON COLUMN nibrun.artifacts.original_file_name IS $c$The name the binary was uploaded under; a content-addressed key carries none. @type import('@repo/protocol').Filename$c$;
COMMENT ON COLUMN nibrun.artifacts.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE INDEX artifacts_app_id_idx ON nibrun.artifacts (app_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON nibrun.artifacts
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();
