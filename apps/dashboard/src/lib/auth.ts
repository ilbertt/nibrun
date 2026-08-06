import { deviceAuthorizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// Same origin in both environments, for the same reason as the api client.
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  // Types `authClient.device.*`. The request methods it declares are inferred correctly without
  // it, so removing it costs no requests — only the accessors the device page is written against.
  plugins: [deviceAuthorizationClient()],
});

export type Session = typeof authClient.$Infer.Session;
