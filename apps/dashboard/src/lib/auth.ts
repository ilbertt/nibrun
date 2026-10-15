import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { anonymousClient, deviceAuthorizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// Same origin in both environments, for the same reason as the api client.
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [deviceAuthorizationClient(), anonymousClient(), oauthProviderClient()],
});

export type Session = typeof authClient.$Infer.Session;
