import { expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRouter,
  isRedirect,
  RouterContextProvider,
} from '@tanstack/react-router';
import { renderToStaticMarkup } from 'react-dom/server';
import { useOAuthQuery } from '#lib/hooks/use-oauth-query.ts';
import { setupBrowserLocation } from '#tests/support/browser.ts';

const location = setupBrowserLocation();
const { Route } = await import('#routes/(auth)/consent.tsx');
const { routeTree } = await import('#routeTree.gen.ts');
type BeforeLoadContext = Parameters<NonNullable<typeof Route.options.beforeLoad>>[0];

const SIGNED_QUERY =
  '?client_id=app&resource=first&resource=second&ba_param=client_id&ba_param=resource&sig=signature';

function consentRouter() {
  return createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [`/consent${SIGNED_QUERY}`] }),
  });
}

function OAuthQuery() {
  return <span>{useOAuthQuery()}</span>;
}

test('OAuth requests retain native repeated parameters when the router normalizes its search', () => {
  location.search = SIGNED_QUERY;
  const router = consentRouter();
  expect(router.state.location.searchStr).not.toBe(SIGNED_QUERY);
  expect(new URLSearchParams(router.state.location.searchStr).getAll('resource')).toEqual([
    '["first","second"]',
  ]);
  const markup = renderToStaticMarkup(
    <RouterContextProvider router={router}>
      <OAuthQuery />
    </RouterContextProvider>,
  );
  expect(markup).toContain(SIGNED_QUERY.replaceAll('&', '&amp;'));
});

test.each([null, true])(
  'consent sends a visitor or anonymous session to login without serializing its signed query: %s',
  (anonymous) => {
    location.search = SIGNED_QUERY;
    const router = consentRouter();
    try {
      Route.options.beforeLoad?.({
        context: { session: anonymous === null ? null : { user: { isAnonymous: anonymous } } },
        location: router.state.location,
      } as BeforeLoadContext);
      throw new Error('Expected the consent route to request sign-in');
    } catch (error) {
      expect(isRedirect(error)).toBe(true);
      if (isRedirect(error)) {
        expect(error.options.href).toBe(`/login${SIGNED_QUERY}`);
        expect(error.options.reloadDocument).toBe(true);
      }
    }
  },
);

test('registered accounts can review the consent request', () => {
  expect(() =>
    Route.options.beforeLoad?.({
      context: { session: { user: { isAnonymous: false } } },
      location: consentRouter().state.location,
    } as BeforeLoadContext),
  ).not.toThrow();
});
