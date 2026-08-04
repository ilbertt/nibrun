import { type Treaty, treaty } from '@elysiajs/eden';
import type { PublicApp } from '@repo/api/types';
import { TREATY_DEFAULTS } from '#treaty.ts';

export type PublicApiClient = Treaty.Create<PublicApp>;

// The return annotation is required: the type Eden infers here isn't portable across packages.
export function createPublicApiClient({ baseUrl }: { baseUrl: string }): PublicApiClient {
  return treaty<PublicApp>(baseUrl, TREATY_DEFAULTS);
}
