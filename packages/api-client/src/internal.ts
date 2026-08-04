import type { Treaty } from '@elysiajs/eden';
import type { InternalApp } from '@repo/api/types';
import { createClient } from '#client.ts';

type InternalApiClient = Treaty.Create<InternalApp>;

// The return annotation is required: the type Eden infers isn't portable across packages. Only
// declaration emit says so, and this package is consumed as source, so nothing here reports it.
export function createInternalApiClient({ baseUrl }: { baseUrl: string }): InternalApiClient {
  return createClient<InternalApp>({ baseUrl });
}
