import { isPublicRoutableHost } from '@better-auth/core/utils/host';
import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider';
import { dns } from 'bun';
import { hostnameOf, IP_V6 } from '#lib/public-address.ts';

export async function fetchClientMetadataResource(
  ...[input, init]: Parameters<ClientMetadataResourceFetch>
): Promise<Response> {
  const request = new Request(input, init);
  const metadataUrl = new URL(request.url);
  if (metadataUrl.protocol !== 'https:' || !['GET', 'HEAD'].includes(request.method)) {
    throw new TypeError('CIMD metadata requires an HTTPS GET or HEAD request.');
  }
  request.signal.throwIfAborted();
  const hostname = hostnameOf(metadataUrl);
  const addresses = await dns.lookup(hostname, { family: 0 });
  if (addresses.length === 0 || !addresses.every(({ address }) => isPublicRoutableHost(address))) {
    throw new TypeError('CIMD metadata must resolve only to public-routable addresses.');
  }
  request.signal.throwIfAborted();
  const address = addresses[0]!;
  const pinnedUrl = new URL(metadataUrl);
  pinnedUrl.hostname = address.family === IP_V6 ? `[${address.address}]` : address.address;
  const headers = new Headers(request.headers);
  headers.set('host', metadataUrl.host);
  return fetch(pinnedUrl, {
    method: request.method,
    headers,
    signal: request.signal,
    redirect: 'manual',
    proxy: false,
    keepalive: false,
    tls: { serverName: hostname },
  });
}
