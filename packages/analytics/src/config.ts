export const UMAMI_WEBSITE_ID = '00000000-0000-4000-8000-000000000001';

export const ANALYTICS_IDENTITY_COOKIE = 'nibrun_analytics';
export const MCP_ATTEMPT_COOKIE = 'nibrun_mcp_attempt';
export const ANALYTICS_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const COOKIE_LIFETIME_DAYS = 90;
export const ANALYTICS_COOKIE_LIFETIME_SECONDS = 60 * 60 * 24 * COOKIE_LIFETIME_DAYS;
