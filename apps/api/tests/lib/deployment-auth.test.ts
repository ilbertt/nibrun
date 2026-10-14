import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { apiKey } from '@better-auth/api-key';
import { Value } from '@sinclair/typebox/value';
import { betterAuth } from 'better-auth';
import { type MemoryDB, memoryAdapter } from 'better-auth/adapters/memory';
import { getSchema } from 'better-auth/db';
import { anonymous, bearer } from 'better-auth/plugins';
import { Elysia, StatusMap } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import type { Auth } from '#lib/auth/better-auth.ts';
import { AuthCaller } from '#lib/auth/caller.ts';
import {
  DEPLOYMENT_TOKEN_PERMISSION,
  protectShortLivedDeploymentTokens,
  shortLivedDeploymentTokenConfiguration,
} from '#lib/auth/deployment-api-keys.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { elysiaErrorHandler, UnauthorizedError } from '#lib/errors.ts';
import { AuthenticationService } from '#services/authentication.service.ts';
import {
  GRANT_APP_ID,
  GRANT_ID,
  githubDeploymentGrant,
} from '#tests/support/github-deployment-grants.ts';

const MS_PER_SECOND = 1000;
const SECRET_LENGTH = 32;
const TOKEN_LIFETIME_SECONDS = 60;
const UPLOAD_PATH = `/apps/${GRANT_APP_ID}/upload`;
const WORKFLOW_ONLY_PATH = `/apps/${GRANT_APP_ID}/workflow-only`;
const REGISTERED_OR_WORKFLOW_PATH = `/apps/${GRANT_APP_ID}/registered-or-workflow`;

function sessionCredential({
  headers,
  token,
  ownerId,
  isAnonymous,
}: {
  headers: Headers;
  token: string | null;
  ownerId: string;
  isAnonymous: boolean;
}) {
  const signedToken = headers.get('set-auth-token');
  if (!token || !signedToken) {
    throw new Error('The account fixture must have a Bearer session token.');
  }
  const cookie = headers
    .getSetCookie()
    .map(function cookieValue(value) {
      return value.split(';')[0];
    })
    .join('; ');
  return { token, signedToken, cookie, ownerId: Value.Parse(OwnerIdSchema, ownerId), isAnonymous };
}

async function setup() {
  const database: MemoryDB = {};
  const auth = betterAuth({
    baseURL: 'https://auth.test',
    secret: 'x'.repeat(SECRET_LENGTH),
    database: memoryAdapter(database),
    emailAndPassword: { enabled: true },
    hooks: { before: protectShortLivedDeploymentTokens },
    plugins: [
      apiKey([
        shortLivedDeploymentTokenConfiguration,
        { configId: 'default', enableMetadata: true, keyExpiration: { minExpiresIn: 0 } },
      ]),
      bearer(),
      anonymous(),
    ],
  });
  for (const table of Object.keys(getSchema(auth.options))) {
    database[table] = [];
  }
  const signup = await auth.api.signUpEmail({
    body: {
      name: 'Owner',
      email: 'owner@example.test',
      password: 'correct-horse-battery-staple',
    },
    returnHeaders: true,
  });
  const registeredAccount = sessionCredential({
    headers: signup.headers,
    token: signup.response.token,
    ownerId: signup.response.user.id,
    isAnonymous: false,
  });
  const signIn = await auth.api.signInAnonymous({ returnHeaders: true });
  const anonymousAccount = sessionCredential({
    headers: signIn.headers,
    token: signIn.response.token,
    ownerId: signIn.response.user.id,
    isAnonymous: true,
  });
  const credential = await auth.api.createApiKey({
    body: {
      configId: shortLivedDeploymentTokenConfiguration.configId,
      userId: registeredAccount.ownerId,
      expiresIn: TOKEN_LIFETIME_SECONDS,
      permissions: { [GRANT_APP_ID]: [DEPLOYMENT_TOKEN_PERMISSION] },
      metadata: { grantId: GRANT_ID },
    },
  });
  const authenticate = mock(function liveGrant() {
    return Promise.resolve({ ...githubDeploymentGrant(), owner_id: registeredAccount.ownerId });
  });
  const app = new Elysia()
    .onError(elysiaErrorHandler)
    .use(
      createAuthPlugin(
        new AuthenticationService({
          auth: auth.api as unknown as Auth['api'],
          grantsService: { authenticate },
        }),
      ),
    )
    .get(
      '/account',
      function account() {
        return 'ok';
      },
      { auth: { policies: [AuthCaller.RegisteredAccount] } },
    )
    .get(
      '/anonymous-account',
      function anonymousAccount() {
        return 'ok';
      },
      { auth: { policies: [AuthCaller.AnonymousAccount] } },
    )
    .post(
      '/apps/:appId/upload',
      function upload({ deploymentAccess }) {
        return deploymentAccess;
      },
      {
        auth: {
          policies: [
            AuthCaller.AnonymousAccount,
            AuthCaller.RegisteredAccount,
            AuthCaller.GitHubOidcDeployment,
          ],
        },
      },
    )
    .post(
      '/apps/:appId/registered-or-workflow',
      function registeredOrWorkflow({ deploymentAccess }) {
        return deploymentAccess;
      },
      { auth: { policies: [AuthCaller.RegisteredAccount, AuthCaller.GitHubOidcDeployment] } },
    )
    .post(
      '/apps/:appId/workflow-only',
      function workflowOnly({ deploymentAccess }) {
        return deploymentAccess;
      },
      { auth: { policies: [AuthCaller.GitHubOidcDeployment] } },
    )
    .post(
      '/unscoped',
      function unscoped() {
        return 'ok';
      },
      {
        auth: {
          policies: [
            AuthCaller.AnonymousAccount,
            AuthCaller.RegisteredAccount,
            AuthCaller.GitHubOidcDeployment,
          ],
        },
      },
    );
  if (!credential.expiresAt) {
    throw new Error('The deployment fixture must expire.');
  }
  return {
    app,
    authenticate,
    credential: { ...credential, expiresAt: credential.expiresAt },
    auth,
    registeredAccount,
    anonymousAccount,
  };
}

function request({ path, headers }: { path: string; headers: RequestInit['headers'] }) {
  return new Request(`http://localhost${path}`, {
    method: path === '/account' || path === '/anonymous-account' ? 'GET' : 'POST',
    headers,
  });
}

function tokenRequest({ token, cookie, path }: { token: string; cookie: string; path: string }) {
  return request({ path, headers: { authorization: `Bearer ${token}`, cookie } });
}

afterEach(function restoreMocks() {
  mock.restore();
});

test('Better Auth authenticates a deployment token over a real cookie session and resolves a live grant', async () => {
  const { app, authenticate, credential, auth, registeredAccount } = await setup();
  const deploymentRequest = tokenRequest({
    token: credential.key,
    cookie: registeredAccount.cookie,
    path: UPLOAD_PATH,
  });
  expect(await auth.api.getSession({ headers: deploymentRequest.headers })).toBeNull();
  const response = await app.handle(deploymentRequest);
  expect(response.status).toBe(StatusMap.OK);
  expect(await response.json()).toEqual({
    ownerId: registeredAccount.ownerId,
    isAnonymous: false,
    deploymentGrant: { expires_at: credential.expiresAt.toISOString() },
  });
  expect(authenticate).toHaveBeenCalledWith({
    appId: GRANT_APP_ID,
    ownerId: registeredAccount.ownerId,
    grantId: GRANT_ID,
  });
});

test('live grant expiry can be earlier than token expiry', async () => {
  const { app, authenticate, credential, registeredAccount } = await setup();
  const grant = {
    ...githubDeploymentGrant(),
    owner_id: registeredAccount.ownerId,
    expires_at: new Date(Date.now() + MS_PER_SECOND),
  };
  authenticate.mockResolvedValue(grant);
  const response = await app.handle(
    tokenRequest({ token: credential.key, cookie: registeredAccount.cookie, path: UPLOAD_PATH }),
  );
  expect(response.status).toBe(StatusMap.OK);
  expect(await response.json()).toMatchObject({
    deploymentGrant: { expires_at: grant.expires_at.toISOString() },
  });
});

test('opaque invalid and expired deployment tokens override a valid cookie without authenticating an account', async () => {
  const { app, authenticate, credential, registeredAccount } = await setup();
  const invalid = await app.handle(
    tokenRequest({ token: 'invalid', cookie: registeredAccount.cookie, path: UPLOAD_PATH }),
  );
  expect(invalid.status).toBe(StatusMap.Unauthorized);
  spyOn(Date, 'now').mockReturnValue(credential.expiresAt.getTime() + MS_PER_SECOND);
  const expired = await app.handle(
    tokenRequest({ token: credential.key, cookie: registeredAccount.cookie, path: UPLOAD_PATH }),
  );
  expect(expired.status).toBe(StatusMap.Unauthorized);
  expect(authenticate).not.toHaveBeenCalled();
});

test('a revoked trust grant cannot authorize a valid credential', async () => {
  const { app, authenticate, credential, registeredAccount } = await setup();
  authenticate.mockRejectedValue(new UnauthorizedError());
  const response = await app.handle(
    tokenRequest({ token: credential.key, cookie: registeredAccount.cookie, path: UPLOAD_PATH }),
  );
  expect(response.status).toBe(StatusMap.Unauthorized);
});

test('deployment tokens cannot authenticate account routes or a different app', async () => {
  const { app, authenticate, credential, registeredAccount } = await setup();
  for (const path of ['/account', '/anonymous-account', '/unscoped', '/apps/another-app/upload']) {
    const response = await app.handle(
      tokenRequest({ token: credential.key, cookie: registeredAccount.cookie, path }),
    );
    expect(response.status).toBe(StatusMap.Unauthorized);
  }
  expect(authenticate).not.toHaveBeenCalled();
});

test('real registered and anonymous cookie sessions remain supported', async () => {
  const { app, authenticate, registeredAccount, anonymousAccount } = await setup();
  for (const account of [registeredAccount, anonymousAccount]) {
    const response = await app.handle(
      request({ path: UPLOAD_PATH, headers: { cookie: account.cookie } }),
    );
    expect(response.status).toBe(StatusMap.OK);
    expect(await response.json()).toEqual({
      ownerId: account.ownerId,
      isAnonymous: account.isAnonymous,
      deploymentGrant: null,
    });
  }
  expect(authenticate).not.toHaveBeenCalled();
});

test('native raw and signed session Bearer tokens select their account over a different account cookie', async () => {
  const { app, authenticate, registeredAccount, anonymousAccount } = await setup();
  for (const account of [registeredAccount, anonymousAccount]) {
    const cookieAccount = account.isAnonymous ? registeredAccount : anonymousAccount;
    for (const token of [
      account.token,
      account.signedToken,
      decodeURIComponent(account.signedToken),
    ]) {
      const response = await app.handle(
        tokenRequest({ token, cookie: cookieAccount.cookie, path: UPLOAD_PATH }),
      );
      expect(response.status).toBe(StatusMap.OK);
      expect(await response.json()).toEqual({
        ownerId: account.ownerId,
        isAnonymous: account.isAnonymous,
        deploymentGrant: null,
      });
    }
  }
  expect(authenticate).not.toHaveBeenCalled();
});

test('native ignored Authorization headers preserve a valid cookie session and still enforce its caller policy', async () => {
  const { app, authenticate, registeredAccount } = await setup();
  for (const authorization of ['Bearer invalid.signature', 'Bearer ', '', 'Basic invalid']) {
    const headers = { authorization, cookie: registeredAccount.cookie };
    const upload = await app.handle(request({ path: UPLOAD_PATH, headers }));
    expect(upload.status).toBe(StatusMap.OK);
    expect(await upload.json()).toEqual({
      ownerId: registeredAccount.ownerId,
      isAnonymous: false,
      deploymentGrant: null,
    });
    const workflow = await app.handle(request({ path: WORKFLOW_ONLY_PATH, headers }));
    expect(workflow.status).toBe(StatusMap.Forbidden);
    const withoutCookie = await app.handle(
      request({ path: UPLOAD_PATH, headers: { authorization } }),
    );
    expect(withoutCookie.status).toBe(StatusMap.Unauthorized);
  }
  expect(authenticate).not.toHaveBeenCalled();
});

test('Better Auth handles deployment Bearer casing and spacing', async () => {
  const { app, credential, registeredAccount } = await setup();
  for (const scheme of ['Bearer ', 'bearer ', 'bEaReR   ']) {
    const response = await app.handle(
      request({
        path: UPLOAD_PATH,
        headers: { authorization: `${scheme}${credential.key}`, cookie: registeredAccount.cookie },
      }),
    );
    expect(response.status).toBe(StatusMap.OK);
  }
});

test('regular keys cannot authenticate deployments even with matching permissions and grant metadata', async () => {
  const { app, authenticate, auth, registeredAccount } = await setup();
  const regular = await auth.api.createApiKey({
    body: {
      configId: 'default',
      userId: registeredAccount.ownerId,
      expiresIn: TOKEN_LIFETIME_SECONDS,
      permissions: { [GRANT_APP_ID]: [DEPLOYMENT_TOKEN_PERMISSION] },
      metadata: { grantId: GRANT_ID },
    },
  });
  const response = await app.handle(
    tokenRequest({ token: regular.key, cookie: registeredAccount.cookie, path: UPLOAD_PATH }),
  );
  expect(response.status).toBe(StatusMap.Unauthorized);
  expect(authenticate).not.toHaveBeenCalled();
});

test('revoked credentials and missing grant references cannot reach live grant authorization', async () => {
  const { app, authenticate, credential, auth, registeredAccount } = await setup();
  for (const mutation of [{ enabled: false }, { enabled: true, metadata: {} }]) {
    await auth.api.updateApiKey({
      body: {
        configId: shortLivedDeploymentTokenConfiguration.configId,
        keyId: credential.id,
        userId: registeredAccount.ownerId,
        ...mutation,
      },
    });
    const response = await app.handle(
      tokenRequest({ token: credential.key, cookie: registeredAccount.cookie, path: UPLOAD_PATH }),
    );
    expect(response.status).toBe(StatusMap.Unauthorized);
  }
  expect(authenticate).not.toHaveBeenCalled();
});

test('registered-account and GitHub OIDC deployment alternatives exclude real anonymous sessions', async () => {
  const { app, authenticate, registeredAccount, anonymousAccount, credential } = await setup();
  const anonymous = await app.handle(
    tokenRequest({
      token: anonymousAccount.token,
      cookie: registeredAccount.cookie,
      path: REGISTERED_OR_WORKFLOW_PATH,
    }),
  );
  expect(anonymous.status).toBe(StatusMap.Forbidden);
  const registered = await app.handle(
    tokenRequest({
      token: registeredAccount.token,
      cookie: anonymousAccount.cookie,
      path: REGISTERED_OR_WORKFLOW_PATH,
    }),
  );
  expect(registered.status).toBe(StatusMap.OK);
  expect(authenticate).not.toHaveBeenCalled();
  const workflow = await app.handle(
    tokenRequest({
      token: credential.key,
      cookie: anonymousAccount.cookie,
      path: REGISTERED_OR_WORKFLOW_PATH,
    }),
  );
  expect(workflow.status).toBe(StatusMap.OK);
  expect(authenticate).toHaveBeenCalledTimes(1);
});

test('a GitHub OIDC deployment policy rejects real account sessions and accepts a deployment token', async () => {
  const { app, authenticate, credential, registeredAccount, anonymousAccount } = await setup();
  for (const account of [registeredAccount, anonymousAccount]) {
    const credentials: RequestInit['headers'][] = [
      { authorization: `Bearer ${account.token}` },
      { cookie: account.cookie },
    ];
    for (const headers of credentials) {
      const response = await app.handle(request({ path: WORKFLOW_ONLY_PATH, headers }));
      expect(response.status).toBe(StatusMap.Forbidden);
    }
  }
  expect(authenticate).not.toHaveBeenCalled();
  const workflow = await app.handle(
    tokenRequest({
      token: credential.key,
      cookie: registeredAccount.cookie,
      path: WORKFLOW_ONLY_PATH,
    }),
  );
  expect(workflow.status).toBe(StatusMap.OK);
  expect(authenticate).toHaveBeenCalledTimes(1);
});

test('account-only policies accept only the native session caller they declare', async () => {
  const { app, authenticate, registeredAccount, anonymousAccount } = await setup();
  for (const path of ['/account', '/anonymous-account']) {
    expect((await app.handle(request({ path, headers: {} }))).status).toBe(StatusMap.Unauthorized);
    for (const account of [registeredAccount, anonymousAccount]) {
      const response = await app.handle(request({ path, headers: { cookie: account.cookie } }));
      const acceptsAccount =
        path === '/anonymous-account' ? account.isAnonymous : !account.isAnonymous;
      expect(response.status).toBe(acceptsAccount ? StatusMap.OK : StatusMap.Forbidden);
    }
  }
  expect(authenticate).not.toHaveBeenCalled();
});
