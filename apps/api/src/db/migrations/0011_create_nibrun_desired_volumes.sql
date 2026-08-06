-- A filesystem outlives the deployments that ran against it, so this is anchored on the app
-- having ever been deployed rather than on it running now: an app whose every deployment failed
-- keeps its data, and so does one nobody has redeployed in a year.
--
-- `deleting` is the only state that produces an `absent`, and an app stays here while it does —
-- a host is told to remove a filesystem by being told to, never by an app quietly dropping out
-- of a list. `deleted` leaves, because by then the host has said it is gone.

CREATE VIEW nibrun.desired_volumes AS
  SELECT a.id AS app_id, a.state
  FROM nibrun.apps a
  WHERE a.state <> 'deleted'
    AND EXISTS (SELECT 1 FROM nibrun.deployments d WHERE d.app_id = a.id);
