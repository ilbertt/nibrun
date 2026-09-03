/**
 * The registrable domain everything public hangs off: the landing page at the apex, the dashboard
 * on a subdomain, and the address an owner writes to. Tenant apps deliberately live elsewhere —
 * their domain is `APP_HOST_DOMAIN`, per deployment, so that an app cannot read dashboard cookies.
 */
export const SITE_DOMAIN = 'nibrun.com';

export const SITE_URL = `https://${SITE_DOMAIN}`;

export const DASHBOARD_URL = `https://app.${SITE_DOMAIN}`;

export const CONTACT_EMAIL = `hello@${SITE_DOMAIN}`;

/**
 * The landing page and the dashboard each link into the other and hand a binary across the
 * boundary between them, so each one needs the other's dev origin as much as its production one.
 * Both must match the `--port` the matching app's `dev` script passes vite.
 */
export const SITE_DEV_URL = 'http://localhost:3002';

export const DASHBOARD_DEV_URL = 'http://localhost:3001';
