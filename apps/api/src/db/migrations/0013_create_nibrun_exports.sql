-- One request for a downloadable copy of an app: its data plus the binary that was running
-- against it. Anchored on the app rather than on a deployment, because what is exported is the
-- filesystem, and a filesystem outlives every deployment that ran against it — an owner asking
-- for their data out has usually stopped the app first, and a stopped app has no live release to
-- hang the request off.
--
-- `artifact_id` is pinned here rather than joined through whatever is deployed now, for the same
-- reason: which binary belongs in the bundle is a fact the control plane holds at request time,
-- and resolving it later would make it unresolvable exactly when it is most wanted.
--
-- `expires_at` is a security bound rather than housekeeping — a bundle carries the tenant's whole
-- dataset — and the bucket's own lifecycle rule is what enforces it. This column is that deadline
-- written down so the api can say it and stop signing past it; the rule is what makes it true.
--
-- The CHECK repeats EXPORT_STATES from @repo/protocol and nothing compares the two, so adding a
-- state there is also a migration here. `expired` is absent deliberately: it is `expires_at`
-- having passed, so storing it would need a sweeper to stay true and would be wrong until one ran.

CREATE TABLE nibrun.exports (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  app_id      uuid NOT NULL REFERENCES nibrun.apps (id) ON DELETE RESTRICT,
  artifact_id uuid NOT NULL REFERENCES nibrun.artifacts (id) ON DELETE RESTRICT,
  state       text NOT NULL DEFAULT 'pending',
  -- Chosen by rule rather than by either end: the host is told this key and writes exactly it,
  -- and the api signs against it without being told anything back. Generated, so the two can
  -- never be made to disagree by a caller that forgot to derive it the same way.
  object_key  text GENERATED ALWAYS AS ('exports/' || app_id::text || '/' || id::text || '.tar.gz') STORED,
  size_bytes  bigint,
  message     text,
  ready_at    timestamptz,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exports_state_check
    CHECK (state IN ('pending', 'preparing', 'ready', 'failed'))
);

COMMENT ON COLUMN nibrun.exports.id IS $c$@type import('@repo/protocol').ExportId$c$;
COMMENT ON COLUMN nibrun.exports.app_id IS $c$@type import('@repo/protocol').AppId$c$;
COMMENT ON COLUMN nibrun.exports.artifact_id IS $c$@type import('@repo/protocol').ArtifactId$c$;
COMMENT ON COLUMN nibrun.exports.state IS $c$@type import('@repo/protocol').ExportState$c$;
COMMENT ON COLUMN nibrun.exports.object_key IS $c$Where the host writes the bundle and the api signs its download URL. @notNull @type import('@repo/protocol').ObjectKey$c$;
COMMENT ON COLUMN nibrun.exports.message IS 'Why the export is in the state it is in, as the host put it. Never the tenant''s own output.';
COMMENT ON COLUMN nibrun.exports.expires_at IS 'When the bucket''s lifecycle rule removes the bundle. The api refuses to sign past it.';
COMMENT ON COLUMN nibrun.exports.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE INDEX exports_app_id_idx ON nibrun.exports (app_id);

CREATE INDEX exports_artifact_id_idx ON nibrun.exports (artifact_id);

-- One export in flight per app, which is what makes a second request a duplicate rather than a
-- second read of a tenant's entire filesystem. Unique rather than a check in the service: two
-- clicks arriving together each look for an in-flight row and neither sees the other's insert,
-- so this is what makes the loser a conflict the insert can resolve into the row that won.
--
-- Only the states that are still going: a finished export does not stop the owner asking for a
-- fresher one, and the point of asking again is that the data has moved on.
CREATE UNIQUE INDEX exports_in_flight_idx
  ON nibrun.exports (app_id) WHERE state IN ('pending', 'preparing');

CREATE TRIGGER set_updated_at BEFORE UPDATE ON nibrun.exports
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();

-- What a host should be doing about exports, as a relation rather than a join written out
-- wherever something reads it.
--
-- Terminal exports stay here as `absent` instead of dropping out: the agent plans only over the
-- rows it is sent, so an export that simply disappears is one the host keeps remembering — and
-- reporting — forever. Saying `absent` is what lets it forget. They leave once expired, by which
-- point they have been `absent` for the bundle's whole lifetime.
CREATE VIEW nibrun.desired_exports AS
  SELECT e.id,
         e.app_id,
         e.object_key,
         e.state,
         ar.digest, ar.size_bytes, ar.object_key AS artifact_object_key, ar.original_file_name
  FROM nibrun.exports e
  JOIN nibrun.apps a ON a.id = e.app_id
  JOIN nibrun.artifacts ar ON ar.id = e.artifact_id
  WHERE e.expires_at > now() AND a.state <> 'deleted';
