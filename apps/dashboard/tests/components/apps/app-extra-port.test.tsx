import { expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterContextProvider } from '@tanstack/react-router';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppSummary } from '#queries/apps.ts';
import type { DeploymentSummary } from '#queries/deployments.ts';
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

const { newestDeploymentQueryOptions } = await import('#queries/deployments.ts');
const APP_ID = 'extra-port-app';

function portMarkup({
  enabled,
  deployment,
}: {
  enabled: boolean;
  deployment: DeploymentSummary | undefined;
}): string {
  const client = new QueryClient();
  if (deployment !== undefined) {
    client.setQueryData(newestDeploymentQueryOptions(APP_ID).queryKey, deployment);
  }
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>
        <AppExtraPort app={{ id: APP_ID, config: { hasExtraPublicPort: enabled } } as AppSummary} />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
}

test('an app without an extra port offers the paid request dialog', () => {
  const markup = portMarkup({ enabled: false, deployment: undefined });
  expect(markup).toContain('Request extra port');
  expect(markup).toContain('aria-haspopup="dialog"');
});

test('an existing extra port keeps its address display', () => {
  const markup = portMarkup({
    enabled: true,
    deployment: { publicIpv4: '192.0.2.1', extraPublicPort: 42000 } as DeploymentSummary,
  });
  expect(markup).toContain('Additional TCP/UDP address');
  expect(markup).toContain('192.0.2.1:42000');
  expect(markup).not.toContain('Request extra port');
});

test('an enabled port awaiting its first report keeps the assignment message', () => {
  const markup = portMarkup({ enabled: true, deployment: undefined });
  expect(markup).toContain('assigned when it starts');
  expect(markup).not.toContain('Request extra port');
});
