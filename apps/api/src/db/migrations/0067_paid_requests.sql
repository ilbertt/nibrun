CREATE TABLE nibrun.paid_requests (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id text NOT NULL REFERENCES auth."user" (id) ON DELETE CASCADE,
  request_type text NOT NULL,
  requested_apps_amount integer,
  created_at timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paid_requests_owner_type_key UNIQUE (owner_id, request_type),
  CONSTRAINT paid_requests_type_check CHECK (request_type IN ('apps')),
  CONSTRAINT paid_requests_requested_apps_amount_check CHECK (
    CASE WHEN request_type = 'apps'
      THEN requested_apps_amount IS NOT NULL AND requested_apps_amount BETWEEN 1 AND 100
      ELSE requested_apps_amount IS NULL
    END
  )
);

COMMENT ON COLUMN nibrun.paid_requests.owner_id IS $c$@type import('#lib/api/identifiers.ts').OwnerId$c$;
COMMENT ON COLUMN nibrun.paid_requests.request_type IS $c$@type import('#lib/api/paid-request.ts').PaidRequest['requestType']$c$;
COMMENT ON COLUMN nibrun.paid_requests.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON nibrun.paid_requests
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();
