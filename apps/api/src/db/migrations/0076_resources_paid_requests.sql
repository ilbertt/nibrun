ALTER TABLE nibrun.paid_requests
  ADD COLUMN requested_vcpu_count integer,
  ADD COLUMN requested_memory_mib integer,
  ADD COLUMN requested_volume_gib integer,
  DROP CONSTRAINT paid_requests_type_check,
  ADD CONSTRAINT paid_requests_type_check CHECK (request_type IN ('apps', 'custom-bucket', 'always-on', 'resources')),
  DROP CONSTRAINT paid_requests_app_id_check,
  ADD CONSTRAINT paid_requests_app_id_check CHECK (
    CASE WHEN request_type IN ('custom-bucket', 'always-on', 'resources') THEN app_id IS NOT NULL ELSE app_id IS NULL END
  ),
  ADD CONSTRAINT paid_requests_requested_vcpu_count_check CHECK (
    CASE WHEN request_type = 'resources'
      THEN requested_vcpu_count IS NOT NULL AND requested_vcpu_count > 0
      ELSE requested_vcpu_count IS NULL
    END
  ),
  ADD CONSTRAINT paid_requests_requested_memory_mib_check CHECK (
    CASE WHEN request_type = 'resources'
      THEN requested_memory_mib IS NOT NULL AND requested_memory_mib > 0
      ELSE requested_memory_mib IS NULL
    END
  ),
  ADD CONSTRAINT paid_requests_requested_volume_gib_check CHECK (
    CASE WHEN request_type = 'resources'
      THEN requested_volume_gib IS NOT NULL AND requested_volume_gib > 0
      ELSE requested_volume_gib IS NULL
    END
  );
