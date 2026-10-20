import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { passwordAccount } from '#tests/controllers/support/accounts.ts';
import { ORIGIN, sendJson } from '#tests/controllers/support/api.ts';

const { auth } = await import('#services/plugins.ts');

function credentials() {
  return { email: `${crypto.randomUUID()}@example.test`, password: 'unknown-account-password' };
}

test('provisioned password accounts receive ordinary registered sessions', async () => {
  const { ownerId, email, password } = await passwordAccount();
  const body = { email, password };
  const response = await sendJson({
    method: 'POST',
    url: `${ORIGIN}/api/auth/sign-in/email`,
    body,
  });
  expect(response.status, await response.clone().text()).toBe(StatusMap.OK);
  expect(await response.json()).toMatchObject({ user: { id: ownerId, isAnonymous: false } });
  expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
  const context = await auth.$context;
  const stored = await context.internalAdapter.findUserByEmail(body.email, {
    includeAccounts: true,
  });
  const account = stored?.accounts.find((account) => account.providerId === 'credential');
  expect(account?.password).toBeString();
  expect(account?.password).not.toBe(password);
  expect(auth.options.socialProviders?.github).toBeDefined();
});

test('public password signup cannot create an account', async () => {
  const body = credentials();
  const response = await sendJson({
    method: 'POST',
    url: `${ORIGIN}/api/auth/sign-up/email`,
    body: { ...body, name: 'Uninvited' },
  });
  expect(response.status).toBe(StatusMap['Bad Request']);
  const context = await auth.$context;
  expect(await context.internalAdapter.findUserByEmail(body.email)).toBeNull();
});

test('unknown accounts and incorrect passwords cannot sign in', async () => {
  const { email, password } = await passwordAccount();
  const body = { email, password };
  for (const attempt of [credentials(), { ...body, password: 'incorrect-password' }]) {
    const response = await sendJson({
      method: 'POST',
      url: `${ORIGIN}/api/auth/sign-in/email`,
      body: attempt,
    });
    expect(response.status).toBe(StatusMap.Unauthorized);
    expect(response.headers.getSetCookie()).toEqual([]);
  }
});

test('password sign-in retains the normal origin and redirect protections', async () => {
  const { email, password } = await passwordAccount();
  const body = { email, password };
  const context = await auth.$context;
  const previous = {
    skipOriginCheck: context.skipOriginCheck,
    skipCSRFCheck: context.skipCSRFCheck,
  };
  try {
    // Better Auth skips browser origin checks under bun:test by default.
    Object.assign(context, { skipOriginCheck: false, skipCSRFCheck: false });
    for (const request of [
      { headers: { origin: 'https://foreign.test' }, body },
      { headers: undefined, body: { ...body, callbackURL: 'https://foreign.test' } },
    ]) {
      const response = await sendJson({
        method: 'POST',
        url: `${ORIGIN}/api/auth/sign-in/email`,
        ...request,
      });
      expect(response.status).toBe(StatusMap.Forbidden);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  } finally {
    Object.assign(context, previous);
  }
});
