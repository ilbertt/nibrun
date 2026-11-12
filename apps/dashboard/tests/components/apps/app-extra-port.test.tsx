import { expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterContextProvider } from '@tanstack/react-router';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppSummary } from '#queries/apps.ts';
import { setupBrowserLocation } from '#tests/support/browser.ts';

setupBrowserLocation();
const { AppExtraPort } = await import('#components/apps/app-extra-port.tsx');
const { routeTree } = await import('#routeTree.gen.ts');
const { sessionQueryOptions } = await import('#queries/session.ts');
const queryClient = new QueryClient();
queryClient.setQueryData(sessionQueryOptions.queryKey, null);
const router = createRouter({
  routeTree,
  context: { queryClient },
  history: createMemoryHistory({ initialEntries: ['/login'] }),
});
await router.load();

test.each([false, true])(
  'a saved extra port setting of %s offers a paid request',
  (hasExtraPublicPort) => {
    const app = { config: { hasExtraPublicPort } } as AppSummary;
    const markup = renderToStaticMarkup(
      <RouterContextProvider router={router}>
        <AppExtraPort app={app} />
      </RouterContextProvider>,
    );

    expect(markup).toContain('Request extra port');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup.includes('Not active')).toBe(hasExtraPublicPort);
    expect(markup).not.toContain('assigned when it starts');
  },
);
