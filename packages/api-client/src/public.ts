import type { Treaty } from '@elysiajs/eden';
import type { PublicApp } from '@repo/api/types';
import {
  type ApiClientOptions,
  createClient,
  createInProcessClient,
  type InProcessApiClientOptions,
} from '#client.ts';

export type { InProcessApiClientOptions } from '#client.ts';

export type PublicApiClient = Treaty.Create<PublicApp>;

// The return annotation is required: the type Eden infers isn't portable across packages. Only
// declaration emit says so, and this package is consumed as source, so nothing here reports it.
export function createPublicApiClient(options: ApiClientOptions): PublicApiClient {
  return createClient<PublicApp>(options);
}

/** The same client for the api's own code, dispatching in-process rather than over the network. */
export function createInProcessPublicApiClient(
  options: InProcessApiClientOptions,
): PublicApiClient {
  return createInProcessClient<PublicApp>(options);
}
