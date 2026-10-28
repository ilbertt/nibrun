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
import type { AppSummary } from '#queries/apps.ts';
import { setupBrowserLocation } from '#tests/support/browser.ts';

setupBrowserLocation();
const { PaidResourcesRequestForm } = await import(
  '#components/apps/paid-resources-request-form.tsx'
);
const { appQueryOptions } = await import('#queries/apps.ts');
const queryClient = new QueryClient();
queryClient.setQueryData(appQueryOptions('resource-request-app').queryKey, {
  config: {
    resources: { vcpuCount: 1, memoryMib: 256 },
    volumeSizeBytes: 8_589_934_592,
  },
} as AppSummary);

const root = createRootRoute();
const dashboard = createRoute({ getParentRoute: () => root, id: '(dashboard)' });
const app = createRoute({ getParentRoute: () => dashboard, path: 'apps/$appId' });
const router = createRouter({
  routeTree: root.addChildren([dashboard.addChildren([app])]),
  history: createMemoryHistory({ initialEntries: ['/apps/resource-request-app'] }),
});
await router.load();

test('the form starts with current resource totals so unchanged resources can be retained', () => {
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <PaidResourcesRequestForm />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  const labels = ['Requested vCPUs', 'Requested RAM (MiB)', 'Requested volume (GiB)'];
  for (const label of labels) {
    expect(markup).toContain(label);
  }
  const inputs = [...markup.matchAll(/<input[^>]*>/g)].map((match) => match[0]);
  expect(inputs).toHaveLength(labels.length);
  const expectedValues = ['1', '256', '8'];
  for (const [index, input] of inputs.entries()) {
    expect(input).toContain(`value="${expectedValues[index]}"`);
    expect(input).toContain('min="1"');
  }
  expect(markup).toContain('Enter the total resources you need');
  expect(markup).toContain('Keep the current value');
  expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>Send request<\/button>/);
});
