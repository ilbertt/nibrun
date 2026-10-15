import { afterAll, beforeEach, expect, test } from 'bun:test';
import { isRedirect } from '@tanstack/react-router';

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const location = { origin: 'https://nibrun.test', search: '' };
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } });

const { authClient } = await import('#lib/auth.ts');
const { Route } = await import('#routes/(auth)/login.tsx');

type BeforeLoadContext = Parameters<NonNullable<typeof Route.options.beforeLoad>>[0];

const SIGNED_QUERY = new URLSearchParams([
  ['client_id', 'https://client.test/metadata.json'],
  ['scope', 'mcp offline_access'],
  ['state', 'state with + and &'],
  ['resource', 'https://nibrun.test/mcp'],
  ['resource', 'https://another.test/mcp'],
  ['prompt', 'login consent'],
  ['ba_param', 'client_id'],
  ['ba_param', 'scope'],
  ['ba_param', 'state'],
  ['ba_param', 'resource'],
  ['ba_param', 'prompt'],
  ['ba_param', 'ba_param'],
  ['sig', 'server-issued-signature'],
]);

beforeEach(() => {
  location.search = '';
});

afterAll(() => {
  if (previousWindow) {
    Object.defineProperty(globalThis, 'window', previousWindow);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

async function socialSignInBody(): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  const result = await authClient.signIn.social(
    { provider: 'github', callbackURL: '/apps', disableRedirect: true },
    {
      async customFetchImpl(...args: Parameters<typeof fetch>) {
        body = await new Request(...args).json();
        return Response.json({ url: 'https://github.com/login/oauth/authorize', redirect: false });
      },
    },
  );
  expect(result.error).toBeNull();
  return body;
}

function visitLogin({
  anonymous,
  search,
}: {
  anonymous: boolean | null;
  search: string;
}): ReturnType<NonNullable<typeof Route.options.beforeLoad>> {
  return Route.options.beforeLoad?.({
    context: { session: anonymous === null ? null : { user: { isAnonymous: anonymous } } },
    search: { redirect: '/apps' },
    location: { searchStr: search },
  } as BeforeLoadContext);
}

test('GitHub sign-in carries the signed authorization query with repeated resources intact', async () => {
  location.search = `?${SIGNED_QUERY}&redirect=%2Fapps&unrelated=ignored`;
  const body = await socialSignInBody();

  expect(body).toMatchObject({ provider: 'github', callbackURL: '/apps' });
  expect(body.oauth_query).toBe(SIGNED_QUERY.toString());
});

test('ordinary sign-in does not send an unsigned page query as OAuth context', async () => {
  location.search = '?redirect=%2Fapps&client_id=untrusted&scope=mcp';
  expect((await socialSignInBody()).oauth_query).toBeUndefined();
});

test('a registered session can complete a signed request that requires fresh sign-in', () => {
  expect(() => visitLogin({ anonymous: false, search: `?${SIGNED_QUERY}` })).not.toThrow();
});

test.each([null, true])('visitors and anonymous sessions can sign in: %s', (anonymous) => {
  expect(() => visitLogin({ anonymous, search: '' })).not.toThrow();
  expect(() => visitLogin({ anonymous, search: `?${SIGNED_QUERY}` })).not.toThrow();
});

test('a registered session still skips ordinary login and respects its destination', () => {
  try {
    visitLogin({ anonymous: false, search: '?redirect=%2Fapps' });
    throw new Error('Expected the login route to redirect');
  } catch (error) {
    expect(isRedirect(error)).toBe(true);
    if (isRedirect(error)) {
      expect(error.options.href).toBe('/apps');
    }
  }
});
