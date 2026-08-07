-- An artifact row is now written before its bytes exist, which is the opposite of what 0008
-- says. The upload no longer passes through the api: a caller is handed somewhere to put the
-- binary and says afterwards that it landed, so the row is what that upload is addressed by and
-- has to exist first.
--
-- What the bytes decide cannot be known until they are there. The digest is taken from them, the
-- size is counted off them, and the key is the digest — so all three are absent until the api has
-- read the object back, and none of them is a claim the uploader was believed about.
--
-- `digest IS NULL` is the whole of "still coming". No state column: a row is complete when what
-- completes it is present, which is the same sentence as the work being done, and there is no
-- second place for that answer to disagree with itself. Every read filters on it, so a pending
-- row is invisible rather than deployable.

ALTER TABLE nibrun.artifacts
  ALTER COLUMN digest DROP NOT NULL,
  ALTER COLUMN size_bytes DROP NOT NULL,
  ALTER COLUMN object_key DROP NOT NULL;

COMMENT ON COLUMN nibrun.artifacts.digest IS $c$Absent until the api has hashed the uploaded object; its presence is what makes the row an artifact. @type import('@repo/protocol').Sha256Digest$c$;
COMMENT ON COLUMN nibrun.artifacts.size_bytes IS 'Counted off the uploaded bytes, so absent until they are there. A Postgres bigint, so it arrives as a string; the wire type is a number.';
COMMENT ON COLUMN nibrun.artifacts.object_key IS $c$Where the verified bytes came to rest, so absent while they are still in a staging slot. Key within ARTIFACTS_BUCKET; which bucket is deploy configuration. @type import('@repo/protocol').ObjectKey$c$;

-- An upload nobody ever completes leaves this row behind, and the bucket rule that expires the
-- staged object cannot reach it. Partial, because the rows worth sweeping are always the few
-- still pending rather than the many that are done.
CREATE INDEX artifacts_pending_idx ON nibrun.artifacts (id) WHERE digest IS NULL;
