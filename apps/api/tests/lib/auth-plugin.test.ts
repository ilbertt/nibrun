import { describe, expect, test } from 'bun:test';
import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin, Identity } from '#lib/auth/plugin.ts';
import { elysiaErrorHandler } from '#lib/errors.ts';

type Session = Awaited<ReturnType<Auth['api']['getSession']>>;

/** A better-auth that answers `getSession` with whatever the test says, and nothing else. */
function authAnswering(session: Session): Auth {
  return { api: { getSession: () => Promise.resolve(session) } } as unknown as Auth;
}

function appBehind(auth: Auth) {
  return new Elysia()
    .onError(elysiaErrorHandler)
    .use(createAuthPlugin(auth))
    .get('/either', () => 'ok', { auth: Identity.Optional })
    .get('/identified', () => 'ok', { auth: Identity.Required });
}

function sessionOf(user: Record<string, unknown>): Session {
  return { user, session: {} } as unknown as Session;
}

const STRANGER = sessionOf({ id: 'stranger', isAnonymous: true });
const SOMEBODY = sessionOf({ id: 'somebody', isAnonymous: false });
// Every user from before there were strangers: better-auth never wrote the column for them.
const FROM_BEFORE = sessionOf({ id: 'from-before', isAnonymous: null });

async function statusOf({ auth, path }: { auth: Auth; path: string }): Promise<number> {
  const response = await appBehind(auth).handle(new Request(`http://localhost${path}`));
  return response.status;
}

describe('a route says what it asks of the session it is given', () => {
  test('nobody is let through anything without one', async () => {
    const auth = authAnswering(null);

    expect(await statusOf({ auth, path: '/either' })).toBe(StatusMap.Unauthorized);
    expect(await statusOf({ auth, path: '/identified' })).toBe(StatusMap.Unauthorized);
  });

  test('a stranger is let through a route that asks for a session, and no further', async () => {
    const auth = authAnswering(STRANGER);

    expect(await statusOf({ auth, path: '/either' })).toBe(StatusMap.OK);
    expect(await statusOf({ auth, path: '/identified' })).toBe(StatusMap.Forbidden);
  });

  test('a person with an identity is let through both', async () => {
    for (const auth of [authAnswering(SOMEBODY), authAnswering(FROM_BEFORE)]) {
      expect(await statusOf({ auth, path: '/either' })).toBe(StatusMap.OK);
      expect(await statusOf({ auth, path: '/identified' })).toBe(StatusMap.OK);
    }
  });
});
