ALTER TABLE nibrun.paid_requests
  ADD COLUMN requested_ports_amount integer,
  ADD CONSTRAINT paid_requests_requested_ports_amount_check CHECK (
    CASE WHEN request_type = 'extra-public-port'
      THEN requested_ports_amount IS NOT NULL AND requested_ports_amount BETWEEN 1 AND 5
      ELSE requested_ports_amount IS NULL
    END
  ),
  DROP CONSTRAINT paid_requests_type_check,
  ADD CONSTRAINT paid_requests_type_check CHECK (request_type IN ('apps', 'custom-bucket', 'always-on', 'resources', 'extra-public-port')),
  DROP CONSTRAINT paid_requests_app_id_check,
  ADD CONSTRAINT paid_requests_app_id_check CHECK (
    CASE WHEN request_type IN ('custom-bucket', 'always-on', 'resources', 'extra-public-port') THEN app_id IS NOT NULL ELSE app_id IS NULL END
  );
