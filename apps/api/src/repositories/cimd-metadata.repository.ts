import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPublicRoutableHost } from '@better-auth/core/utils/host';
import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider';
import { hostnameOf, IP_V6 } from '#lib/public-address.ts';

type MetadataFetchInput = {
  input: Parameters<ClientMetadataResourceFetch>[0];
  init: Parameters<ClientMetadataResourceFetch>[1];
};
type ResolveAddresses = (host: string) => Promise<string[]>;
export type CimdMetadataRequest = { url: URL; init: BunFetchRequestInit };
type FetchMetadata = (input: CimdMetadataRequest) => Promise<Response>;

export abstract class CimdMetadataRepositoryContract {
  abstract fetch(input: MetadataFetchInput): Promise<Response>;
}

export class CimdMetadataRepository implements CimdMetadataRepositoryContract {
  private readonly resolveAddresses: ResolveAddresses;
  private readonly fetchMetadata: FetchMetadata;

  constructor({
    resolve = resolveMetadataAddresses,
    fetch = fetchPinnedMetadata,
  }: { resolve?: ResolveAddresses; fetch?: FetchMetadata } = {}) {
    this.resolveAddresses = resolve;
    this.fetchMetadata = fetch;
  }

  async fetch({ input, init }: MetadataFetchInput): Promise<Response> {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.protocol !== 'https:' || !['GET', 'HEAD'].includes(request.method)) {
      throw new TypeError('Client metadata requires an HTTPS GET or HEAD request.');
    }
    const host = hostnameOf(url);
    const addresses = await this.resolveAddresses(host);
    if (addresses.length === 0 || !addresses.every(isPublicRoutableHost)) {
      throw new TypeError('Client metadata must resolve only to public addresses.');
    }
    const address = addresses[0]!;
    const dialled = new URL(url);
    dialled.hostname = isIP(address) === IP_V6 ? `[${address}]` : address;
    const headers = new Headers(request.headers);
    headers.set('host', url.host);
    return this.fetchMetadata({
      url: dialled,
      init: {
        method: request.method,
        headers,
        signal: request.signal,
        redirect: 'manual',
        proxy: false,
        keepalive: false,
        tls: { serverName: host },
      },
    });
  }
}

function fetchPinnedMetadata({ url, init }: CimdMetadataRequest): Promise<Response> {
  return fetch(url, init);
}

async function resolveMetadataAddresses(host: string): Promise<string[]> {
  if (isIP(host)) {
    return [host];
  }
  return (await lookup(host, { all: true, verbatim: true })).map(({ address }) => address);
}
