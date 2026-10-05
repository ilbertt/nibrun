CREATE TABLE nibrun.deploy_keys (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  app_id     uuid NOT NULL REFERENCES nibrun.apps (id) ON DELETE CASCADE,
  name       text NOT NULL,
  public_key text NOT NULL,
  created_at timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deploy_keys_app_public_key_key UNIQUE (app_id, public_key)
);

COMMENT ON TABLE nibrun.deploy_keys IS 'Public keys authorized to deploy a binary to one app. Ownership follows the app.';
COMMENT ON COLUMN nibrun.deploy_keys.id IS $c$@type import('#lib/api/identifiers.ts').DeployKeyId$c$;
COMMENT ON COLUMN nibrun.deploy_keys.app_id IS $c$@type import('@repo/protocol').AppId$c$;
COMMENT ON COLUMN nibrun.deploy_keys.public_key IS 'Canonical OpenSSH public key without a comment or authorized_keys options.';
COMMENT ON COLUMN nibrun.deploy_keys.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON nibrun.deploy_keys
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();

CREATE OR REPLACE VIEW nibrun.purgeable_apps AS
  SELECT a.id AS app_id
  FROM nibrun.apps a
  WHERE a.state = 'deleted'
    AND (EXISTS (SELECT 1 FROM nibrun.artifacts ar WHERE ar.app_id = a.id)
      OR EXISTS (SELECT 1 FROM nibrun.exports e WHERE e.app_id = a.id)
      OR EXISTS (SELECT 1 FROM nibrun.app_hostnames h WHERE h.app_id = a.id)
      OR EXISTS (SELECT 1 FROM nibrun.imports im WHERE im.app_id = a.id)
      OR EXISTS (SELECT 1 FROM nibrun.deploy_keys k WHERE k.app_id = a.id));
