-- Fifteen minutes rather than the hour 0048 gave, for the same reason the hour was chosen: the
-- window decides how many strangers can hold an app at once, and fifteen minutes is enough to
-- open the URL and find the sign-in button. A profile written under 0048 keeps its hour, and is
-- gone with its app within one.
--
-- Quoted to the dashboard by `ANONYMOUS_APP_LIFETIME_MINUTES` in `@repo/global-constants`, which
-- is kept in step by hand.

CREATE OR REPLACE FUNCTION nibrun.add_profile() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW."isAnonymous" THEN
    INSERT INTO nibrun.profiles (owner_id, quota_apps_max_count, app_lifetime_seconds)
      VALUES (NEW.id, 1, 900)
      ON CONFLICT (owner_id) DO NOTHING;
  ELSE
    INSERT INTO nibrun.profiles (owner_id) VALUES (NEW.id) ON CONFLICT (owner_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
