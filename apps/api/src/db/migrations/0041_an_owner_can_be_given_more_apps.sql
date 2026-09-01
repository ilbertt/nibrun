CREATE VIEW nibrun.app_quotas AS
  SELECT p.owner_id,
         held.apps_held,
         p.quota_apps_max_count AS apps_allowed,
         GREATEST(p.quota_apps_max_count - held.apps_held, 0) AS apps_left
  FROM nibrun.profiles p
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS apps_held
    FROM nibrun.live_apps a
    WHERE a.owner_id = p.owner_id
  ) held;
