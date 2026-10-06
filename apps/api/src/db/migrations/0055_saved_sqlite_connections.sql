CREATE TABLE nibrun.sqlite_connections (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  app_id     uuid NOT NULL REFERENCES nibrun.apps (id) ON DELETE CASCADE,
  sqlite_file_path text NOT NULL,
  created_at timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN nibrun.sqlite_connections.id IS $c$@type import('#lib/api/identifiers.ts').SqliteConnectionId$c$;
COMMENT ON COLUMN nibrun.sqlite_connections.app_id IS $c$@type import('@repo/protocol').AppId$c$;
COMMENT ON COLUMN nibrun.sqlite_connections.sqlite_file_path IS $c$@type import('@repo/protocol').GuestPath$c$;
COMMENT ON COLUMN nibrun.sqlite_connections.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE INDEX sqlite_connections_app_id_idx ON nibrun.sqlite_connections (app_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON nibrun.sqlite_connections
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();
