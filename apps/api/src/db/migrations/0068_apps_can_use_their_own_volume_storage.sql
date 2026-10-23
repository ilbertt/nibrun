CREATE TABLE nibrun.app_volume_storage (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  app_id uuid NOT NULL REFERENCES nibrun.apps (id) ON DELETE RESTRICT,
  configuration text NOT NULL,
  CONSTRAINT app_volume_storage_app_id_key UNIQUE (app_id)
);

COMMENT ON TABLE nibrun.app_volume_storage IS 'Optional storage for an app''s lifetime. No row means shared storage. Configure before the first deployment; changing an existing filesystem''s backend is not a migration.';
COMMENT ON COLUMN nibrun.app_volume_storage.app_id IS $c$@type import('@repo/protocol').AppId$c$;
COMMENT ON COLUMN nibrun.app_volume_storage.configuration IS $c$S3VolumeStorage sealed with TENANT_SECRETS_KEY; credentials and encryption password never reach the database in plaintext. @type import('#lib/tenant-secrets.ts').SealedSecret$c$;

-- A row removed or replaced would send the next poll to a different filesystem. Backend
-- migration and credential rotation need an explicit host transition before either is allowed.
CREATE TRIGGER app_volume_storage_append_only
  BEFORE UPDATE OR DELETE ON nibrun.app_volume_storage
  FOR EACH ROW EXECUTE FUNCTION nibrun.refuse_write();
