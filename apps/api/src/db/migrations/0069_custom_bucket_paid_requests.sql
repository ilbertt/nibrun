ALTER TABLE nibrun.paid_requests
  DROP CONSTRAINT paid_requests_type_check,
  ADD CONSTRAINT paid_requests_type_check CHECK (request_type IN ('apps', 'custom-bucket'));
