import { expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import { renderToStaticMarkup } from 'react-dom/server';
import { setupBrowserLocation } from '#tests/support/browser.ts';

setupBrowserLocation();
const { PaidExtraPortRequestForm } = await import(
  '#components/apps/paid-extra-port-request-form.tsx'
);
const queryClient = new QueryClient();

const root = createRootRoute();
const dashboard = createRoute({ getParentRoute: () => root, id: '(dashboard)' });
const app = createRoute({ getParentRoute: () => dashboard, path: 'apps/$appId' });
const router = createRouter({
  routeTree: root.addChildren([dashboard.addChildren([app])]),
  history: createMemoryHistory({ initialEntries: ['/apps/port-request-app'] }),
});
await router.load();

test('the port form asks for the app’s requested total, starting with one', () => {
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <PaidExtraPortRequestForm />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  expect(markup).toContain('How many extra public ports do you need?');
  const inputs = [...markup.matchAll(/<input[^>]*>/g)].map((match) => match[0]);
  expect(inputs).toHaveLength(1);
  expect(inputs[0]).toContain('type="number"');
  expect(inputs[0]).toContain('min="1"');
  expect(inputs[0]).toContain('max="5"');
  expect(inputs[0]).toContain('step="1"');
  expect(inputs[0]).toContain('value="1"');
  expect(inputs[0]).toContain('required');
  expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>Send request<\/button>/);
});
