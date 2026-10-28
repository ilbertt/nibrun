ALTER TABLE nibrun.paid_requests
  ADD COLUMN additional_vcpu_count integer,
  ADD COLUMN additional_memory_mib integer,
  ADD COLUMN additional_volume_gib integer,
  DROP CONSTRAINT paid_requests_type_check,
  ADD CONSTRAINT paid_requests_type_check CHECK (request_type IN ('apps', 'custom-bucket', 'always-on', 'resources')),
  DROP CONSTRAINT paid_requests_app_id_check,
  ADD CONSTRAINT paid_requests_app_id_check CHECK (
    CASE WHEN request_type IN ('custom-bucket', 'always-on', 'resources') THEN app_id IS NOT NULL ELSE app_id IS NULL END
  ),
  ADD CONSTRAINT paid_requests_additional_vcpu_count_check CHECK (
    CASE WHEN request_type = 'resources'
      THEN additional_vcpu_count IS NOT NULL AND additional_vcpu_count >= 0
      ELSE additional_vcpu_count IS NULL
    END
  ),
  ADD CONSTRAINT paid_requests_additional_memory_mib_check CHECK (
    CASE WHEN request_type = 'resources'
      THEN additional_memory_mib IS NOT NULL AND additional_memory_mib >= 0
      ELSE additional_memory_mib IS NULL
    END
  ),
  ADD CONSTRAINT paid_requests_additional_volume_gib_check CHECK (
    CASE WHEN request_type = 'resources'
      THEN additional_volume_gib IS NOT NULL AND additional_volume_gib >= 0
      ELSE additional_volume_gib IS NULL
    END
  ),
  ADD CONSTRAINT paid_requests_resource_increase_check CHECK (
    request_type <> 'resources' OR additional_vcpu_count > 0 OR additional_memory_mib > 0 OR additional_volume_gib > 0
  );
