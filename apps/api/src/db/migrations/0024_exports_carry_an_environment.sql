-- Which config version the bundle's `.env` is written from.
--
-- Pinned at request time for the same reason `artifact_id` is: an owner asking for their data out
-- has usually stopped the app first, and the variables it ran with are held by a config version
-- that nothing live points at any more. Resolving it later would make it unresolvable exactly
-- when it is most wanted.
--
-- Nullable, because rows written before this column existed have no answer and a migration may
-- not invent one. An export carrying no config version exports no variables, which is what an app
-- with none looks like too.

ALTER TABLE nibrun.exports
  ADD COLUMN config_id uuid REFERENCES nibrun.app_configs (id) ON DELETE RESTRICT;

COMMENT ON COLUMN nibrun.exports.config_id IS
  $c$The config version whose environment belongs in the bundle, pinned when the export was asked for.$c$;

CREATE INDEX exports_config_id_idx ON nibrun.exports (config_id);

-- Appended, because CREATE OR REPLACE VIEW may only add columns at the end.
CREATE OR REPLACE VIEW nibrun.desired_exports AS
  SELECT e.id,
         e.app_id,
         e.object_key,
         e.state,
         ar.digest, ar.size_bytes, ar.object_key AS artifact_object_key, ar.original_file_name,
         e.config_id
  FROM nibrun.exports e
  JOIN nibrun.apps a ON a.id = e.app_id
  JOIN nibrun.artifacts ar ON ar.id = e.artifact_id
  WHERE e.expires_at > now() AND a.state <> 'deleted';

-- The second relation carrying values rather than names, beside `desired_environment` and for the
-- same reason: it is read on the way to the host that writes the bundle, which is the only place
-- they are wanted.
CREATE VIEW nibrun.desired_export_environment AS
  SELECT e.id AS export_id, env.name, env.value
  FROM nibrun.app_config_environment env
  JOIN nibrun.desired_exports e ON e.config_id = env.config_id;
