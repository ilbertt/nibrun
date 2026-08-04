import { createPublicApiClient } from '@repo/api-client/public';

// Same origin in both environments: in production the api binary serves the dashboard,
// in development Vite proxies the api prefix to the api (see vite.config.ts).
export const api = createPublicApiClient({ baseUrl: window.location.origin });
