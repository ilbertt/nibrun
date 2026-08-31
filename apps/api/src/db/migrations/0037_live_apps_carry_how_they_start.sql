-- `0035` put `activation` and `idle_timeout_ms` on `nibrun.apps`, where a host reads them through
-- `desired_deployments`. Every statement that resolves an app *for its owner* reads `live_apps`
-- instead, and that view names its columns rather than selecting `*` — so the two were reachable
-- by the fleet and invisible to the person whose app they decide.
--
-- Appended last, because CREATE OR REPLACE VIEW may only add columns at the end.
CREATE OR REPLACE VIEW nibrun.live_apps AS
  SELECT id, owner_id, slug, state, created_at, updated_at, activation, idle_timeout_ms
  FROM nibrun.apps
  WHERE state <> 'deleted';
