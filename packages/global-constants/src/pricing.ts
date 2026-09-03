/**
 * Kept in step by hand with the `quota_apps_max_count` default in
 * `apps/api/src/db/migrations/0040_a_profile_carries_an_app_quota.sql`: a migration is frozen once
 * it has run, so the number an owner is actually held to is the database's, and this is only what
 * the price is quoted from.
 */
export const FREE_APPS_COUNT = 3;

export const PRICE_PER_APP_USD = 1;
