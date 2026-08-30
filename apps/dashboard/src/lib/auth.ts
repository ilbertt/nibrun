import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { deviceAuthorizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// Same origin in both environments, for the same reason as the api client.
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  // Types `authClient.device.*` and `authClient.oauth2.*`. The request methods they declare are
  // inferred correctly without them, so removing one costs no requests — only the accessors the
  // device and consent pages are written against.
  plugins: [deviceAuthorizationClient(), oauthProviderClient()],
});

export type Session = typeof authClient.$Infer.Session;
