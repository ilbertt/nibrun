-- An owner names an app when they create it, and until now the name was read once to mint the
-- slug and dropped. The slug is what the app is served under, so it cannot follow a rename and has
-- a random tail no owner chose; the name is what they call it, and what they name it by.
--
-- Nullable for now: every app already here is given its slug as a name by hand —
-- `UPDATE nibrun.apps SET name = slug WHERE name IS NULL` — and a later migration adds NOT NULL
-- once none is missing one. Until then an app without a name answers to its slug, which
-- `AppsService` is what says.

ALTER TABLE nibrun.apps
  ADD COLUMN name text;

COMMENT ON COLUMN nibrun.apps.name IS $c$What its owner calls the app, and names it by. @type import('@repo/protocol').AppName$c$;

-- Unique among the apps an owner still has: a name stands for an app the way the slug does, and
-- two apps answering to one name is a command acting on the wrong one. A deleted app's name is
-- free again — it is the slug that is never reissued, and that is the slug's own constraint.
CREATE UNIQUE INDEX apps_owner_id_name_key ON nibrun.apps (owner_id, name)
  WHERE state <> 'deleted';

-- Appended last, because CREATE OR REPLACE VIEW may only add columns at the end.
CREATE OR REPLACE VIEW nibrun.live_apps AS
  SELECT id, owner_id, slug, state, created_at, updated_at, activation, idle_timeout_ms,
         data_initialized_at, name
  FROM nibrun.apps
  WHERE state <> 'deleted';
