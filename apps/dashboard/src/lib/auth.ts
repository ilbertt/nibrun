import { deviceAuthorizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// Same origin in both environments, for the same reason as the api client.
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  // The dashboard is the only place a waiting CLI can be approved: approving is an authenticated
  // act, and the browser is where the owner is already signed in.
  plugins: [deviceAuthorizationClient()],
});

export type Session = typeof authClient.$Infer.Session;
