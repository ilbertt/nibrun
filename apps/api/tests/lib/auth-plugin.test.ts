import { describe, expect, mock, test } from 'bun:test';
import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { Identity } from '#lib/auth/identity.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { createDeploymentGrantToken } from '#lib/deployment-grant-token.ts';
import { elysiaErrorHandler } from '#lib/errors.ts';
import { AuthenticationService } from '#services/authentication.service.ts';
import { GRANT_OWNER_ID, githubDeploymentGrant } from '#tests/support/github-deployment-grants.ts';

type Session = Awaited<ReturnType<Auth['api']['getSession']>>;

function authPlugin({
  auth,
  grantsService,
}: {
  auth: Auth;
  grantsService: ConstructorParameters<typeof AuthenticationService>[0]['grantsService'];
}) {
  const authenticationService = new AuthenticationService({
    auth: auth.api,
    grantsService,
  });
  return createAuthPlugin(authenticationService);
}

/** A better-auth that answers `getSession` with whatever the test says, and nothing else. */
function authAnswering(session: Session): Auth {
  return {
    api: {
      getSession: function getSession() {
        return Promise.resolve(session);
      },
    },
  } as unknown as Auth;
}

function appBehind(auth: Auth) {
  return new Elysia()
    .onError(elysiaErrorHandler)
    .use(
      authPlugin({
        auth,
        grantsService: {
          authenticate() {
            throw new Error('Account routes must not authenticate grants.');
          },
        },
      }),
    )
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

function deploymentGrantToken() {
  return createDeploymentGrantToken({ ownerId: GRANT_OWNER_ID });
}

test('account policies reject deployment credentials before consulting an account session', async function rejectGrantOnAccountRoutes() {
  const getSession = mock(function sessionLookup() {
    return Promise.resolve(SOMEBODY);
  });
  const authenticate = mock(function grantLookup() {
    return Promise.resolve(githubDeploymentGrant());
  });
  const auth = { api: { getSession } } as unknown as Auth;
  const app = new Elysia()
    .onError(elysiaErrorHandler)
    .use(authPlugin({ auth, grantsService: { authenticate } }))
    .get(
      '/either',
      function either() {
        return 'ok';
      },
      { auth: Identity.Optional },
    )
    .get(
      '/identified',
      function identified() {
        return 'ok';
      },
      { auth: Identity.Required },
    );
  for (const path of ['/either', '/identified']) {
    const response = await app.handle(
      new Request(`http://localhost${path}`, {
        headers: {
          authorization: `Bearer ${deploymentGrantToken()}`,
          cookie: 'better-auth.session_token=valid-session',
        },
      }),
    );
    expect(response.status).toBe(StatusMap.Unauthorized);
  }
  expect(getSession).not.toHaveBeenCalled();
  expect(authenticate).not.toHaveBeenCalled();
});

test('account authorization headers are passed to Better Auth unchanged', async function delegateBearerHandling() {
  const getSession = mock(function sessionLookup(input: { headers: Headers }) {
    expect(input.headers.get('authorization')).toBe('Bearer account-token');
    return Promise.resolve(SOMEBODY);
  });
  const auth = { api: { getSession } } as unknown as Auth;
  const response = await appBehind(auth).handle(
    new Request('http://localhost/either', {
      headers: { authorization: 'Bearer account-token' },
    }),
  );
  expect(response.status).toBe(StatusMap.OK);
  expect(getSession).toHaveBeenCalledTimes(1);
});

test('app deployment policy preserves the same account normalization as account policies', async function normalizeUploadAccount() {
  const authenticate = mock(function grantLookup() {
    throw new Error('Account uploads must not authenticate grants.');
  });
  for (const session of [STRANGER, SOMEBODY, FROM_BEFORE]) {
    const app = new Elysia()
      .onError(elysiaErrorHandler)
      .use(authPlugin({ auth: authAnswering(session), grantsService: { authenticate } }))
      .post(
        '/apps/:appId/artifacts',
        function upload({ deploymentAccess }) {
          return deploymentAccess;
        },
        { auth: { deploymentGrant: true } },
      );
    const response = await app.handle(
      new Request('http://localhost/apps/app-1/artifacts', { method: 'POST' }),
    );
    expect(response.status).toBe(StatusMap.OK);
    expect(await response.json()).toEqual({
      ownerId: session?.user.id,
      isAnonymous: session?.user.isAnonymous === true,
      deploymentGrant: null,
    });
  }
  expect(authenticate).not.toHaveBeenCalled();
});

test('grant authentication requires an explicit app scope', async function requireGrantScope() {
  const getSession = mock(function sessionLookup() {
    return Promise.resolve(SOMEBODY);
  });
  const authenticate = mock(function grantLookup() {
    return Promise.resolve(githubDeploymentGrant());
  });
  const auth = { api: { getSession } } as unknown as Auth;
  const app = new Elysia()
    .onError(elysiaErrorHandler)
    .use(authPlugin({ auth, grantsService: { authenticate } }))
    .post(
      '/unscoped',
      function upload() {
        return 'ok';
      },
      { auth: { deploymentGrant: true } },
    );
  const response = await app.handle(
    new Request('http://localhost/unscoped', {
      method: 'POST',
      headers: { authorization: `Bearer ${deploymentGrantToken()}` },
    }),
  );
  expect(response.status).toBe(StatusMap.Unauthorized);
  expect(getSession).not.toHaveBeenCalled();
  expect(authenticate).not.toHaveBeenCalled();
});

test('app deployment policy accepts standard bearer scheme casing and spacing', async function standardBearer() {
  const grant = githubDeploymentGrant();
  const getSession = mock(function sessionLookup() {
    return Promise.resolve(SOMEBODY);
  });
  const authenticate = mock(function grantLookup() {
    return Promise.resolve(grant);
  });
  const auth = { api: { getSession } } as unknown as Auth;
  const app = new Elysia()
    .onError(elysiaErrorHandler)
    .use(authPlugin({ auth, grantsService: { authenticate } }))
    .post(
      '/apps/:appId/artifacts',
      function upload({ deploymentAccess }) {
        return deploymentAccess;
      },
      { auth: { deploymentGrant: true } },
    );
  const token = deploymentGrantToken();
  for (const scheme of ['Bearer ', 'bearer ', 'bEaReR   ']) {
    const response = await app.handle(
      new Request('http://localhost/apps/app-1/artifacts', {
        method: 'POST',
        headers: {
          authorization: `${scheme}${token}`,
          cookie: 'better-auth.session_token=valid-session',
        },
      }),
    );
    expect(response.status).toBe(StatusMap.OK);
    expect(await response.json()).toEqual({
      ownerId: grant.owner_id,
      isAnonymous: false,
      deploymentGrant: { expires_at: grant.expires_at.toISOString() },
    });
    expect(authenticate).toHaveBeenLastCalledWith({ appId: grant.app_id, token });
  }
  expect(getSession).not.toHaveBeenCalled();
});
