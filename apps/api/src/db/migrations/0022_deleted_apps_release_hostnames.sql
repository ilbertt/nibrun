-- Hostnames are part of what a deleted app leaves behind. The app row itself stays so its slug
-- is never issued again, which means the hostname rows cannot rely on their cascading foreign
-- key to disappear.
--
-- Including them here makes the same retryable cleanup that removes binaries and exports also
-- find deleted apps from before hostname cleanup existed.

CREATE OR REPLACE VIEW nibrun.purgeable_apps AS
  SELECT a.id AS app_id
  FROM nibrun.apps a
  WHERE a.state = 'deleted'
    AND (EXISTS (SELECT 1 FROM nibrun.artifacts ar WHERE ar.app_id = a.id)
      OR EXISTS (SELECT 1 FROM nibrun.exports e WHERE e.app_id = a.id)
      OR EXISTS (SELECT 1 FROM nibrun.app_hostnames h WHERE h.app_id = a.id));
