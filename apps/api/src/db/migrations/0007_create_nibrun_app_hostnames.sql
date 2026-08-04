-- The CHECK repeats APP_HOSTNAME_KINDS from @repo/protocol and nothing compares the two, so
-- adding a kind there is also a migration here.
--
-- UNIQUE on the hostname alone, rather than per app: one uniqueness domain over platform and
-- custom together is what stops a brought domain from claiming a hostname nibrun issued.

CREATE TABLE nibrun.app_hostnames (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  app_id     uuid NOT NULL REFERENCES nibrun.apps (id) ON DELETE CASCADE,
  hostname   text NOT NULL,
  kind       text NOT NULL,
  created_at timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_hostnames_hostname_key UNIQUE (hostname),
  CONSTRAINT app_hostnames_kind_check CHECK (kind IN ('platform', 'custom'))
);

COMMENT ON COLUMN nibrun.app_hostnames.app_id IS $c$@type import('@repo/protocol').AppId$c$;
COMMENT ON COLUMN nibrun.app_hostnames.hostname IS $c$@type import('@repo/protocol').Hostname$c$;
COMMENT ON COLUMN nibrun.app_hostnames.kind IS $c$@type import('@repo/protocol').AppHostnameKind$c$;
COMMENT ON COLUMN nibrun.app_hostnames.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE INDEX app_hostnames_app_id_idx ON nibrun.app_hostnames (app_id);

-- An app has one hostname nibrun issued it, which is what lets `AppHostname.isDefault` be
-- derived from `kind` rather than stored.
CREATE UNIQUE INDEX app_hostnames_platform_idx
  ON nibrun.app_hostnames (app_id) WHERE kind = 'platform';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON nibrun.app_hostnames
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();
