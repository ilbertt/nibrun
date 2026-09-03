import { DASHBOARD_SITE_DEV_URL, DASHBOARD_SITE_URL } from '@repo/global-constants';

// The landing page both links to the dashboard and posts a binary into a frame the dashboard
// serves, so where it lives is named once here rather than once per use.
export const DASHBOARD_ORIGIN = import.meta.env.DEV ? DASHBOARD_SITE_DEV_URL : DASHBOARD_SITE_URL;
