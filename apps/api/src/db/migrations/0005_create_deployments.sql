CREATE TABLE nibrun.deployments (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'starting', 'active', 'superseded', 'failed', 'cancelled')),
  target_generation integer
    CHECK (target_generation IS NULL OR target_generation >= 0),
  deadline_at timestamptz,
  activated_at timestamptz,
  failure_reason text
    CHECK (failure_reason IS NULL OR char_length(failure_reason) <= 512),
  created_at timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deployments_target_and_deadline_move_together
    CHECK ((target_generation IS NULL) = (deadline_at IS NULL)),
  CONSTRAINT deployments_progress_requires_schedule
    CHECK (
      state NOT IN ('starting', 'active', 'superseded', 'failed')
      OR target_generation IS NOT NULL
    ),
  CONSTRAINT deployments_pending_is_unscheduled
    CHECK (state <> 'pending' OR target_generation IS NULL),
  CONSTRAINT deployments_active_requires_activation
    CHECK (state NOT IN ('active', 'superseded') OR activated_at IS NOT NULL),
  CONSTRAINT deployments_activation_only_when_active
    CHECK (state IN ('active', 'superseded') OR activated_at IS NULL),
  CONSTRAINT deployments_failed_requires_reason
    CHECK (state <> 'failed' OR failure_reason IS NOT NULL),
  CONSTRAINT deployments_failure_reason_only_on_failure
    CHECK (state = 'failed' OR failure_reason IS NULL)
);

COMMENT ON COLUMN nibrun.deployments.created_at IS
  'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE INDEX deployments_deadline_idx
  ON nibrun.deployments (deadline_at, id)
  WHERE state = 'starting';

CREATE TRIGGER deployments_set_updated_at
  BEFORE UPDATE ON nibrun.deployments
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();
