-- The CHECK repeats APP_STATES from @repo/protocol and nothing compares the two, so adding a
-- state there is also a migration here.

CREATE TABLE nibrun.apps (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id          text NOT NULL REFERENCES auth."user" ("id") ON DELETE RESTRICT,
  slug              text NOT NULL,
  state             text NOT NULL DEFAULT 'active',
  created_at        timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT apps_slug_key UNIQUE (slug),
  CONSTRAINT apps_state_check CHECK (state IN ('active', 'suspended', 'deleting', 'deleted'))
);

COMMENT ON COLUMN nibrun.apps.id IS $c$@type import('@repo/protocol').AppId$c$;
COMMENT ON COLUMN nibrun.apps.owner_id IS $c$@type import('@repo/protocol').OwnerId$c$;
COMMENT ON COLUMN nibrun.apps.slug IS $c$@type import('@repo/protocol').DnsLabel$c$;
COMMENT ON COLUMN nibrun.apps.state IS $c$@type import('@repo/protocol').AppState$c$;
COMMENT ON COLUMN nibrun.apps.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE INDEX apps_owner_id_idx ON nibrun.apps (owner_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON nibrun.apps
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();
