ALTER TABLE nibrun.profiles
  ADD COLUMN feature_custom_buckets_allowed boolean NOT NULL DEFAULT false;

CREATE FUNCTION nibrun.require_custom_bucket_permission() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Config edits inherit the latest config; rollbacks inherit the deployed volume.
  IF EXISTS (
    SELECT 1 FROM nibrun.app_configs c
    WHERE c.app_id = NEW.app_id
      AND c.id IN (
        (SELECT id FROM nibrun.app_configs WHERE app_id = NEW.app_id ORDER BY id DESC LIMIT 1),
        (SELECT config_id FROM nibrun.deployments WHERE app_id = NEW.app_id ORDER BY id DESC LIMIT 1)
      )
      AND c.volume_storage_endpoint = NEW.volume_storage_endpoint
      AND c.volume_storage_bucket = NEW.volume_storage_bucket
      AND rtrim(c.volume_storage_prefix, '/') = rtrim(NEW.volume_storage_prefix, '/')
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM nibrun.profiles p
  JOIN nibrun.apps a ON a.owner_id = p.owner_id
  WHERE a.id = NEW.app_id AND p.feature_custom_buckets_allowed
  FOR SHARE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Custom buckets are not enabled for this app owner'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER require_custom_bucket_permission BEFORE INSERT ON nibrun.app_configs
  FOR EACH ROW WHEN (NEW.volume_storage_endpoint IS NOT NULL)
  EXECUTE FUNCTION nibrun.require_custom_bucket_permission();
