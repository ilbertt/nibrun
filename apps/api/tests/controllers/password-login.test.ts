import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, sendJson } from '#tests/controllers/support/api.ts';

const { auth } = await import('#services/plugins.ts');
const { createPasswordAccount } = await import('#lib/auth/create-password-account.ts');
const PASSWORD = 'review-account-test-password';

function credentials() {
  return { email: `${crypto.randomUUID()}@example.test`, password: PASSWORD };
}

test('provisioned password accounts receive ordinary registered sessions', async () => {
  const body = credentials();
  const ownerId = await createPasswordAccount({ auth, ...body, name: 'Demo' });
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
  expect(account?.password).not.toBe(PASSWORD);
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
  const body = credentials();
  await createPasswordAccount({ auth, ...body, name: 'Demo' });
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

test('provisioning refuses existing accounts and invalid password lengths', async () => {
  const body = credentials();
  const input = { auth, ...body, name: 'Demo' };
  await createPasswordAccount(input);
  await expect(
    createPasswordAccount({ ...input, email: body.email.toUpperCase() }),
  ).rejects.toThrow('already exists');
  const context = await auth.$context;
  const fresh = credentials();
  for (const length of [
    context.password.config.minPasswordLength - 1,
    context.password.config.maxPasswordLength + 1,
  ]) {
    await expect(
      createPasswordAccount({ auth, ...fresh, name: 'Demo', password: 'x'.repeat(length) }),
    ).rejects.toThrow('Password must contain');
  }
  expect(await context.internalAdapter.findUserByEmail(fresh.email)).toBeNull();
});

test('password sign-in retains the normal origin and redirect protections', async () => {
  const body = credentials();
  await createPasswordAccount({ auth, ...body, name: 'Demo' });
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
