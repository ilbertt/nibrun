import { createAuthClient } from 'better-auth/react';

// Same origin in both environments, for the same reason as the api client.
export const authClient = createAuthClient({ baseURL: window.location.origin });

export type Session = typeof authClient.$Infer.Session;
