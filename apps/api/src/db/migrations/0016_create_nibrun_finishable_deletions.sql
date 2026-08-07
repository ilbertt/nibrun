-- An app whose deletion has nothing left to wait for.
--
-- Reaching `deleted` takes a host saying the filesystem is gone, and a host is only ever told
-- about a filesystem the app has been deployed onto at least once — so an app deployed no times
-- waits on a sentence nobody will ever speak. Having never had a filesystem, it has nothing on
-- any host to wait for either.
--
-- Read off `desired_volumes` rather than the deployments underneath it, because what decides this
-- is whether a host will be told, and that view is where that is decided. Two copies of the rule
-- would be two chances for a host and this to disagree about the same app.
--
-- A relation rather than a state written down, so an app leaves by having been finished and the
-- ones stuck here from before there was anything to finish them are found by the same read.

CREATE VIEW nibrun.finishable_deletions AS
  SELECT a.id AS app_id
  FROM nibrun.apps a
  WHERE a.state = 'deleting'
    AND NOT EXISTS (SELECT 1 FROM nibrun.desired_volumes v WHERE v.app_id = a.id);
