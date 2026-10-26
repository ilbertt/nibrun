ALTER TABLE nibrun.paid_requests
  ADD COLUMN app_id uuid REFERENCES nibrun.apps (id) ON DELETE CASCADE,
  DROP CONSTRAINT paid_requests_owner_type_key,
  ADD CONSTRAINT paid_requests_owner_type_app_key UNIQUE NULLS NOT DISTINCT (owner_id, request_type, app_id);

-- Existing account-level bucket requests have no app ID to backfill; keep them while enforcing new writes.
ALTER TABLE nibrun.paid_requests
  ADD CONSTRAINT paid_requests_app_id_check CHECK (
    CASE WHEN request_type = 'custom-bucket' THEN app_id IS NOT NULL ELSE app_id IS NULL END
  ) NOT VALID;

COMMENT ON COLUMN nibrun.paid_requests.app_id IS $c$@type import('@repo/protocol').AppId$c$;

CREATE INDEX paid_requests_app_id_idx ON nibrun.paid_requests (app_id) WHERE app_id IS NOT NULL;
