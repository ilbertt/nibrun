CREATE TABLE nibrun.trusted_workflows (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  app_id uuid NOT NULL UNIQUE REFERENCES nibrun.apps (id) ON DELETE CASCADE,
  repository text NOT NULL,
  workflow text NOT NULL,
  branch text NOT NULL,
  environment text,
  created_at timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN nibrun.trusted_workflows.app_id IS $c$@type import('@repo/protocol').AppId$c$;
COMMENT ON COLUMN nibrun.trusted_workflows.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON nibrun.trusted_workflows
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();
