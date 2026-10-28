ALTER TABLE nibrun.paid_requests
  DROP CONSTRAINT paid_requests_type_check,
  ADD CONSTRAINT paid_requests_type_check CHECK (request_type IN ('apps', 'custom-bucket', 'always-on', 'resources')),
  DROP CONSTRAINT paid_requests_app_id_check,
  ADD CONSTRAINT paid_requests_app_id_check CHECK (
    CASE WHEN request_type IN ('custom-bucket', 'always-on', 'resources') THEN app_id IS NOT NULL ELSE app_id IS NULL END
  );
