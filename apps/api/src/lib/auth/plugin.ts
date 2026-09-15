import Elysia from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { ForbiddenError, UnauthorizedError } from '#lib/errors.ts';

/**
 * What a route asks of the session it is given. Every session belongs to somebody; an identity
 * is what a stranger's lacks.
 */
export enum Identity {
  Optional = 'optional',
  Required = 'required',
}

/**
 * Use the plugin this makes with any controller. Elysia will deduplicate it across all routes.
 */
export function createAuthPlugin(auth: Auth) {
  return new Elysia({ name: 'auth' }).macro({
    auth: (identity: Identity) => ({
      async resolve({ request }) {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) {
          throw new UnauthorizedError();
        }
        if (identity === Identity.Required && session.user.isAnonymous) {
          throw new ForbiddenError('Sign in to do this.');
        }
        return { user: session.user, session: session.session };
      },
    }),
  });
}
