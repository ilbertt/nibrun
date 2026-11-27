CREATE OR REPLACE VIEW nibrun.desired_exports AS
  SELECT e.id,
         e.app_id,
         e.object_key,
         e.state,
         ar.digest, ar.size_bytes, ar.object_key AS artifact_object_key, ar.original_file_name,
         e.config_id,
         ar.image_repository, ar.image_program, ar.image_working_directory
  FROM nibrun.exports e
  JOIN nibrun.apps a ON a.id = e.app_id
  JOIN nibrun.artifacts ar ON ar.id = e.artifact_id
  WHERE e.expires_at > now() AND a.state <> 'deleted';
