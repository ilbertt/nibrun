import { afterAll, expect, test } from 'bun:test';
import { mcpConsentOutcome } from '#lib/mcp-consent-outcome.ts';
import { setupBrowserLocation } from '#tests/support/browser.ts';

const location = setupBrowserLocation();
const { authClient } = await import('#lib/auth.ts');
const previousHref = Object.getOwnPropertyDescriptor(location, 'href');
const observations: string[] = [];
Object.defineProperty(location, 'href', {
  configurable: true,
  set() {
    observations.push('redirect');
  },
});

afterAll(() => {
  if (previousHref) {
    Object.defineProperty(location, 'href', previousHref);
  } else {
    Reflect.deleteProperty(location, 'href');
  }
});

test('consent outcomes can be tracked before the auth client redirects away', async () => {
  const result = await authClient.oauth2.consent(
    { accept: true, oauth_query: '?signed-query' },
    {
      onSuccess({ data }) {
        observations.push(mcpConsentOutcome({ accept: true, data }));
      },
      customFetchImpl: function consentResponse() {
        return Promise.resolve(
          Response.json({ redirect: true, url: 'https://client.test/callback?code=private-code' }),
        );
      },
    },
  );
  expect(result.error).toBeNull();
  expect(observations).toEqual(['approved', 'redirect']);
});
