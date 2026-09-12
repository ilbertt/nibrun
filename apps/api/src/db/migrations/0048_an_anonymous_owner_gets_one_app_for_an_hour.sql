-- A user better-auth signs in without an identity is given a profile that says so in nibrun's
-- terms: one app, kept for an hour. Signing in with an identity moves the app to a profile
-- with the defaults, which is what keeping it means.
--
-- An hour, because a sleeping app still holds one of a host's slots for as long as it exists,
-- so the window is what decides how much of a host strangers can hold at once — and an app is
-- shown the moment it is due to go, so the hour is a prompt to sign in rather than a cliff.
--
-- `isAnonymous` is better-auth's column and null on every user it wrote before the plugin, so
-- the test is for true rather than for not false.

CREATE OR REPLACE FUNCTION nibrun.add_profile() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW."isAnonymous" THEN
    INSERT INTO nibrun.profiles (owner_id, quota_apps_max_count, app_lifetime_seconds)
      VALUES (NEW.id, 1, 3600)
      ON CONFLICT (owner_id) DO NOTHING;
  ELSE
    INSERT INTO nibrun.profiles (owner_id) VALUES (NEW.id) ON CONFLICT (owner_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
