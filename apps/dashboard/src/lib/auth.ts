import { anonymousClient, deviceAuthorizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// Same origin in both environments, for the same reason as the api client.
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  // Types `authClient.device.*` and `authClient.signIn.anonymous`, and `isAnonymous` on the
  // session's user. The request methods are inferred correctly without them, so removing one
  // costs no requests — only the accessors the pages are written against.
  plugins: [deviceAuthorizationClient(), anonymousClient()],
});

export type Session = typeof authClient.$Infer.Session;
