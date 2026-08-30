import type { PublicApiClient } from '@repo/api-client/public';

/** A route that answers, in the shape Eden hands every reply back in. */
export function answering<T>(data: T): () => Promise<{ data: T; error: null }> {
  return () => Promise.resolve({ data, error: null });
}

/**
 * Eden spells a path segment and its parameter as the same name, so a listing hangs off the
 * function that addresses one app rather than sitting beside it — which is why a client cannot
 * simply be an object literal, and why every file here would otherwise write this out again.
 */
export function apiHolding({
  apps,
  underApp = () => ({}),
}: {
  apps?: Array<{ id: string; slug: string; state?: string }>;
  underApp?: (addressed: { appId: string }) => object;
}): PublicApiClient {
  function addressed(app: { appId: string }) {
    return underApp(app);
  }

  const route =
    apps === undefined ? addressed : Object.assign(addressed, { get: answering({ apps }) });

  return { api: { apps: route } } as unknown as PublicApiClient;
}
