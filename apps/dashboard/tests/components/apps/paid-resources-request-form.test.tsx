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
const { PaidResourcesRequestForm } = await import(
  '#components/apps/paid-resources-request-form.tsx'
);

const root = createRootRoute();
const dashboard = createRoute({ getParentRoute: () => root, id: '(dashboard)' });
const app = createRoute({ getParentRoute: () => dashboard, path: 'apps/$appId' });
const router = createRouter({
  routeTree: root.addChildren([dashboard.addChildren([app])]),
  history: createMemoryHistory({ initialEntries: ['/apps/resource-request-app'] }),
});
await router.load();

test('the form offers separate additional CPU, RAM and volume amounts with explicit units', () => {
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <RouterContextProvider router={router}>
        <PaidResourcesRequestForm />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  const labels = ['Additional vCPUs', 'Additional RAM (MiB)', 'Additional volume (GiB)'];
  for (const label of labels) {
    expect(markup).toContain(label);
  }
  const inputs = [...markup.matchAll(/<input[^>]*>/g)].map((match) => match[0]);
  expect(inputs).toHaveLength(labels.length);
  expect(inputs.every((input) => input.includes('value="0"') && input.includes('min="0"'))).toBe(
    true,
  );
  expect(markup).toContain('Use 0 to leave a resource unchanged');
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Send request<\/button>/);
});
