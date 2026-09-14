-- `0050` added the column nullable so that every app from before it could be given its slug as a
-- name by hand. That has been done, so from here an app without a name cannot exist — and the
-- code that answered one with its slug in the meantime goes with this.

ALTER TABLE nibrun.apps
  ALTER COLUMN name SET NOT NULL;
