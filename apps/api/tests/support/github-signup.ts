import assert from 'node:assert/strict';
import { bunSqlAdapter } from '@ilbertt/better-auth-bun-sql';
import { SQL } from 'bun';
import { StatusMap } from 'elysia';
import { TEST_SECRETS_KEY_BASE64 } from '#tests/support/secrets.ts';

const ORIGIN = 'http://localhost:3000';
const DATABASE_URL = 'postgres://nibrun:nibrun@127.0.0.1:55432/nibrun_test';
const LEGACY_USER_ID = 'github-existing-owner';
const LEGACY_ACCOUNT_ID = 'github-existing-account';
const LEGACY_GITHUB_ID = 123;
const NEW_GITHUB_ID = 456;
const ANONYMOUS_GITHUB_ID = 789;
const SECRET_BYTES = 32;

Object.assign(process.env, {
  BASE_URL: ORIGIN,
  DATABASE_URL,
  BETTER_AUTH_SECRET: Buffer.from(crypto.getRandomValues(new Uint8Array(SECRET_BYTES))).toString(
    'hex',
  ),
  CHATGPT_CLIENT_ID: '',
  CHATGPT_CLIENT_SECRET: '',
  GITHUB_CLIENT_ID: 'test',
  GITHUB_CLIENT_SECRET: 'test',
  S3_ENDPOINT: 'http://127.0.0.1:1',
  VICTORIALOGS_ENDPOINT: 'http://127.0.0.1:1',
  ARTIFACTS_BUCKET: 'test',
  EXPORTS_BUCKET: 'test-exports',
  IMPORTS_BUCKET: 'test-imports',
  S3_ACCESS_KEY_ID: 'test',
  S3_SECRET_ACCESS_KEY: 'test',
  S3_REGION: 'test',
  APP_HOST_DOMAIN: 'apps.test',
  TENANT_SECRETS_KEY: TEST_SECRETS_KEY_BASE64,
});

let githubId = NEW_GITHUB_ID;
const originalFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  function githubResponse(input: string | URL | Request) {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://github.com/login/oauth/access_token') {
      return Promise.resolve(
        Response.json({
          access_token: 'test-github-token',
          token_type: 'bearer',
          scope: 'read:user,user:email',
        }),
      );
    }
    if (url === 'https://api.github.com/user') {
      return Promise.resolve(
        Response.json({
          id: githubId,
          login: `github-${githubId}`,
          name: 'GitHub owner',
          email: `github-${githubId}@example.test`,
        }),
      );
    }
    if (url === 'https://api.github.com/user/emails') {
      return Promise.resolve(
        Response.json([
          { email: `github-${githubId}@example.test`, primary: true, verified: true },
        ]),
      );
    }
    throw new Error(`Unexpected outbound request: ${url}`);
  },
  { preconnect: originalFetch.preconnect },
);

const { createAuth } = await import('#lib/auth/better-auth.ts');
const sql = new SQL(DATABASE_URL);
const claims: Array<{ from: string; to: string }> = [];
const auth = createAuth({
  database: bunSqlAdapter({ sql, pgSchema: 'auth' }),
  appsService: {
    claim(input) {
      claims.push(input);
      return Promise.resolve();
    },
  },
});

function cookies(headers: Headers) {
  return headers
    .getSetCookie()
    .map(function cookieValue(value) {
      return value.split(';')[0];
    })
    .join('; ');
}

async function githubLogin(cookie: string) {
  const started = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
      body: JSON.stringify({
        provider: 'github',
        callbackURL: `${ORIGIN}/signed-in`,
        disableRedirect: true,
      }),
    }),
  );
  assert.equal(started.status, StatusMap.OK, await started.clone().text());
  const { url } = (await started.json()) as { url: string };
  const state = new URL(url).searchParams.get('state');
  assert.ok(state);
  const callback = await auth.handler(
    new Request(
      `${ORIGIN}/api/auth/callback/github?code=test-code&state=${encodeURIComponent(state)}`,
      {
        headers: { cookie: [cookie, cookies(started.headers)].filter(Boolean).join('; ') },
      },
    ),
  );
  assert.equal(callback.status, StatusMap.Found);
  assert.equal(callback.headers.get('location'), `${ORIGIN}/signed-in`);
  const session = await auth.api.getSession({
    headers: new Headers({ cookie: cookies(callback.headers) }),
  });
  assert.ok(session);
  return { session, cookie: cookies(callback.headers) };
}

try {
  const signup = await githubLogin('');
  assert.equal(signup.session.user.email, `github-${NEW_GITHUB_ID}@example.test`);
  const [newAccount] =
    await sql`SELECT "providerId", "accountId", issuer FROM auth.account WHERE "userId" = ${signup.session.user.id}`;
  assert.equal(newAccount.providerId, 'github');
  assert.equal(newAccount.accountId, String(NEW_GITHUB_ID));
  assert.equal(newAccount.issuer, null);

  await sql`INSERT INTO auth."user" (id,name,email,"emailVerified") VALUES (${LEGACY_USER_ID}, 'Existing owner', ${`github-${LEGACY_GITHUB_ID}@example.test`}, true)`;
  await sql`INSERT INTO auth.account (id,"accountId","providerId","userId",issuer,"updatedAt") VALUES (${LEGACY_ACCOUNT_ID},${String(LEGACY_GITHUB_ID)},'github',${LEGACY_USER_ID},'local:oauth:github',now())`;
  githubId = LEGACY_GITHUB_ID;
  const returning = await githubLogin('');
  assert.equal(returning.session.user.id, LEGACY_USER_ID);
  const [legacyAccount] =
    await sql`SELECT id,issuer FROM auth.account WHERE "userId" = ${LEGACY_USER_ID}`;
  assert.equal(legacyAccount.id, LEGACY_ACCOUNT_ID);
  assert.equal(legacyAccount.issuer, 'local:oauth:github');

  const anonymous = await auth.api.signInAnonymous({ returnHeaders: true });
  githubId = ANONYMOUS_GITHUB_ID;
  const upgraded = await githubLogin(cookies(anonymous.headers));
  assert.notEqual(upgraded.session.user.isAnonymous, true);
  assert.deepEqual(claims, [{ from: anonymous.response.user.id, to: upgraded.session.user.id }]);
  const [deletedAnonymous] =
    await sql`SELECT count(*)::integer AS count FROM auth."user" WHERE id=${anonymous.response.user.id}`;
  assert.equal(deletedAnonymous.count, 0);
  const existingSession = await auth.api.getSession({
    headers: new Headers({ cookie: signup.cookie }),
  });
  assert.equal(existingSession?.user.id, signup.session.user.id);
} finally {
  globalThis.fetch = originalFetch;
  await sql.end();
}
