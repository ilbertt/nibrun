import { type Treaty, treaty } from '@elysiajs/eden';
import type { InternalApp } from '@repo/api/types';
import { TREATY_DEFAULTS } from '#treaty.ts';

export type InternalApiClient = Treaty.Create<InternalApp>;

// The return annotation is required: the type Eden infers here isn't portable across packages.
export function createInternalApiClient({
  baseUrl,
  fetcher,
}: {
  baseUrl: string;
  fetcher?: typeof fetch;
}): InternalApiClient {
  return treaty<InternalApp>(baseUrl, { ...TREATY_DEFAULTS, fetcher });
}
