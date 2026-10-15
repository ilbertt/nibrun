import { unwrap } from '@repo/api-client/unwrap';
import { queryOptions } from '@tanstack/react-query';
import { api } from '#lib/api.ts';

const ICON_STALE_TIME_MS = 300_000;

export function oauthClientIconQueryOptions(clientUri: string | undefined) {
  return queryOptions({
    queryKey: ['oauth-client-icon', clientUri],
    enabled: Boolean(clientUri),
    queryFn: async () =>
      clientUri
        ? unwrap(await api.api.oauth['client-icon'].get({ query: { url: clientUri } })).iconUrl
        : null,
    retry: false,
    staleTime: ICON_STALE_TIME_MS,
  });
}
