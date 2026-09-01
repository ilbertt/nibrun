ALTER TABLE nibrun.profiles
  ADD COLUMN quota_apps_max_count integer NOT NULL DEFAULT 3,
  ADD CONSTRAINT profiles_quota_apps_max_count_check CHECK (quota_apps_max_count >= 0);
