-- What an app leaves behind once its filesystem is gone: the binaries it was deployed from and
-- the bundles it was exported into. Both outlive the app until something removes them, and the
-- objects behind them are a tenant's code and a tenant's whole dataset.
--
-- A relation rather than a flag on the app, so a purge that fails half way is retried by being
-- asked again rather than by remembering it was owed. An app leaves this view by having nothing
-- left, which is the same sentence as the work being done.
--
-- Membership is `deleted` rather than `deleting`: until a host says the filesystem is gone the
-- app is still being torn down, and an export the host is still writing would be a row deleted
-- out from under the write.

CREATE INDEX apps_deleted_idx ON nibrun.apps (id) WHERE state = 'deleted';

CREATE VIEW nibrun.purgeable_apps AS
  SELECT a.id AS app_id
  FROM nibrun.apps a
  WHERE a.state = 'deleted'
    AND (EXISTS (SELECT 1 FROM nibrun.artifacts ar WHERE ar.app_id = a.id)
      OR EXISTS (SELECT 1 FROM nibrun.exports e WHERE e.app_id = a.id));
