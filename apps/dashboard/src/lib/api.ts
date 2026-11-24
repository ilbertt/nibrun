import { createPublicApiClient } from '@repo/api-client/public';
import { HttpOperationClient, OPERATION_CLIENT_HEADER } from '@repo/api-constants';

// Same origin in both environments: in production the api binary serves the dashboard,
// in development Vite proxies the api prefix to the api (see vite.config.ts).
export const api = createPublicApiClient({
  baseUrl: window.location.origin,
  headers: { [OPERATION_CLIENT_HEADER]: HttpOperationClient.Dashboard },
});
