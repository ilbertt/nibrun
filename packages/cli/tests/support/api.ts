import type { PublicApiClient } from '@repo/api-client/public';
import { APP_ID, SLUG } from '#tests/support/app.ts';

export type ListedApp = {
  id: string;
  slug: string;
  state?: string;
  hostnames?: Array<{ hostname: string }>;
};

export const RUNNING_DEPLOYMENT = { id: 'deployment-1', state: 'running' };

export function listedApp(overrides: Partial<ListedApp> = {}): ListedApp {
  return { id: APP_ID, slug: SLUG, state: 'active', ...overrides };
}

/** A route that answers, in the shape Eden hands every reply back in. */
export function answering<T>(data: T): () => Promise<{ data: T; error: null }> {
  return () => Promise.resolve({ data, error: null });
}

export function deploymentsHolding(
  deployments: Array<{ id: string; state?: string; artifactId?: string }>,
) {
  return { get: answering({ deployments }) };
}

/**
 * Eden spells a path segment and its parameter as the same name, so the listing hangs off the
 * function that addresses one app — which is the whole reason a client cannot simply be an object
 * literal, and the reason every file here would otherwise write this out again.
 */
export function apiHolding({
  apps,
  underApp = () => ({}),
}: {
  apps: ListedApp[] | (() => ListedApp[]);
  underApp?: (addressed: { appId: string }) => object;
}): PublicApiClient {
  const listing = typeof apps === 'function' ? apps : () => apps;

  function addressed(app: { appId: string }) {
    return underApp(app);
  }

  const route = Object.assign(addressed, {
    get: () => Promise.resolve({ data: { apps: listing() }, error: null }),
  });

  return { api: { apps: route } } as unknown as PublicApiClient;
}
