import type { Treaty } from '@elysiajs/eden';
import type { PublicApp } from '@repo/api/types';
import { createClient } from '#client.ts';

type PublicApiClient = Treaty.Create<PublicApp>;

// The return annotation is required: the type Eden infers isn't portable across packages. Only
// declaration emit says so, and this package is consumed as source, so nothing here reports it.
export function createPublicApiClient({ baseUrl }: { baseUrl: string }): PublicApiClient {
  return createClient<PublicApp>({ baseUrl });
}
