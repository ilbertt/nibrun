-- An owner's apps can be given a lifetime, after which they are deleted rather than kept.
--
-- On the profile, beside the quota, because it is the same kind of thing: a number nibrun holds
-- about a person, decided by how they arrived. Null is the ordinary case — an app lives until its
-- owner deletes it — and an app is read against its owner's profile rather than stamped with a
-- deadline of its own, so an app that changes hands takes on the lifetime of the profile it
-- lands in with nothing to clear.
--
-- Seconds in an integer rather than an interval, as `idle_timeout_ms` is milliseconds in one:
-- the generated row types map no interval, and a column typed `unknown` is one nothing can read.

ALTER TABLE nibrun.profiles
  ADD COLUMN app_lifetime_seconds integer,
  ADD CONSTRAINT profiles_app_lifetime_seconds_check CHECK (app_lifetime_seconds > 0);

COMMENT ON COLUMN nibrun.profiles.app_lifetime_seconds IS 'How long an app of this owner''s is kept before it is deleted; null keeps it until the owner does.';

-- When each app whose owner gives it a lifetime is due to go. A view beside the app rather than
-- a column on `live_apps`, because that view is read `FOR UPDATE` and a join inside it would be
-- locked along with the app — or refused outright, on the nullable side of an outer join.
--
-- Read by the same two things that read `app_usage`: the owner, who is shown it, and — through
-- `expirable_apps` below — the sweep that acts on it.
CREATE VIEW nibrun.app_deadlines AS
  SELECT a.id AS app_id,
         a.created_at + make_interval(secs => p.app_lifetime_seconds) AS expires_at
  FROM nibrun.apps a
  JOIN nibrun.profiles p ON p.owner_id = a.owner_id
  WHERE p.app_lifetime_seconds IS NOT NULL;

COMMENT ON COLUMN nibrun.app_deadlines.app_id IS '@notNull';
COMMENT ON COLUMN nibrun.app_deadlines.expires_at IS 'When this app is due to be deleted. @notNull';

-- An app whose time is up and that nobody has started deleting. The owner is carried because
-- deleting an app is done as its owner, and this is the one deletion no owner asks for.
--
-- Read off `app_deadlines` rather than restating its arithmetic, so what an owner is shown and
-- what is deleted cannot disagree about the same app.
--
-- A relation rather than a state written down, so an app leaves by having been moved on, and
-- a pass that fails part way is retried by the next one finding the same app still listed.
CREATE VIEW nibrun.expirable_apps AS
  SELECT a.id AS app_id, a.owner_id
  FROM nibrun.live_apps a
  JOIN nibrun.app_deadlines d ON d.app_id = a.id
  WHERE a.state <> 'deleting'
    AND d.expires_at <= now();

COMMENT ON COLUMN nibrun.expirable_apps.app_id IS '@notNull';
COMMENT ON COLUMN nibrun.expirable_apps.owner_id IS '@notNull';
