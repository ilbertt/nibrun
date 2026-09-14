import type { PublicApiClient } from '@repo/api-client/public';
import { APP_ID, NAME, SLUG } from '#tests/support/app.ts';

export type ListedApp = {
  id: string;
  name: string;
  slug: string;
  state?: string;
  hostnames?: Array<{ hostname: string }>;
};

export const RUNNING_DEPLOYMENT = { id: 'deployment-1', state: 'running' };

export function listedApp(overrides: Partial<ListedApp> = {}): ListedApp {
  return { id: APP_ID, name: NAME, slug: SLUG, state: 'active', ...overrides };
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

  // One app answers by id the way the api does: the row the listing holds, or a 404.
  function addressed(app: { appId: string }) {
    const listed = listing().find((each) => each.id === app.appId);
    return {
      get: () =>
        Promise.resolve(
          listed
            ? { data: listed, error: null }
            : { data: null, error: { status: 404, value: { error: 'App not found.' } } },
        ),
      ...underApp(app),
    };
  }

  const route = Object.assign(addressed, {
    get: () => Promise.resolve({ data: { apps: listing() }, error: null }),
  });

  return { api: { apps: route } } as unknown as PublicApiClient;
}
