import { createPublicApiClient } from '@repo/api-client/public';
import { DASHBOARD_ORIGIN } from '#lib/dashboard-origin.ts';

export const api = createPublicApiClient({ baseUrl: DASHBOARD_ORIGIN });
