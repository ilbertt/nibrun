import { DASHBOARD_SITE } from '@repo/global-constants';

export const DASHBOARD_ORIGIN = import.meta.env.DEV ? DASHBOARD_SITE.devUrl : DASHBOARD_SITE.url;
