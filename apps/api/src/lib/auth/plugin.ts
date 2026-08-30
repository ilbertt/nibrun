import Elysia from 'elysia';
import { auth } from '#lib/auth/better-auth.ts';
import { UnauthorizedError } from '#lib/errors.ts';

/** The two places better-auth reads a caller from, and so the whole of what could name one. */
const CREDENTIAL_HEADERS = ['cookie', 'authorization'];

/**
 * Use this plugin in with any controller. Elysia will deduplicate it across all routes.
 */
export const authPlugin = new Elysia({ name: 'auth' }).macro({
  auth: {
    async resolve({ request }) {
      const session = await sessionFor(request);
      if (!session) {
        throw new UnauthorizedError();
      }
      return { user: session.user, session: session.session };
    },
  },
});

/**
 * Who is asking, where the request says anything about that at all.
 *
 * A request carrying neither a cookie nor a bearer token is answered without asking better-auth:
 * a session is looked up by one or the other, so there is nothing for a lookup to find, and since
 * the oauth provider a lookup reaches the database. That makes an anonymous request cost a round
 * trip to be told what its own headers already said.
 */
function sessionFor(request: Request) {
  const named = CREDENTIAL_HEADERS.some((header) => request.headers.has(header));
  return named ? auth.api.getSession({ headers: request.headers }) : null;
}
