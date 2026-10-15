import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { type DNSLookup, dns } from 'bun';
import { StatusMap } from 'elysia';
import { fetchClientMetadataResource } from '#lib/auth/cimd-transport.ts';
import { IP_V4, IP_V6 } from '#lib/public-address.ts';

const METADATA_URL = 'https://client.example:8443/oauth/client.json?version=1';
const PUBLIC_ADDRESS: DNSLookup = { address: '1.1.1.1', family: IP_V4, ttl: 0 };

afterEach(function restoreTransportMocks() {
  mock.restore();
});

test('resolves once and pins the address while preserving Host, TLS identity, headers, and aborts', async () => {
  const resolve = spyOn(dns, 'lookup').mockResolvedValue([PUBLIC_ADDRESS]);
  const send = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(null, { status: StatusMap['Not Modified'] }),
  );
  const abort = new AbortController();
  const response = await fetchClientMetadataResource(METADATA_URL, {
    signal: abort.signal,
    headers: { 'if-none-match': 'cached-version', host: 'untrusted' },
  });
  expect(response.status).toBe(StatusMap['Not Modified']);
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(resolve).toHaveBeenCalledWith('client.example', { family: 0 });
  expect(send).toHaveBeenCalledTimes(1);
  const [url, init] = send.mock.calls[0]!;
  expect(String(url)).toBe('https://1.1.1.1:8443/oauth/client.json?version=1');
  const headers = new Headers(init?.headers);
  expect(headers.get('host')).toBe('client.example:8443');
  expect(headers.get('if-none-match')).toBe('cached-version');
  expect(init).toMatchObject({
    method: 'GET',
    redirect: 'manual',
    proxy: false,
    keepalive: false,
    tls: { serverName: 'client.example' },
  });
  abort.abort();
  expect(init?.signal?.aborted).toBe(true);
});

test.each([
  '127.0.0.1',
  '10.0.0.1',
  '169.254.169.254',
  '192.0.2.1',
  '::1',
  '::ffff:127.0.0.1',
  '2001:db8::1',
])('rejects mixed DNS answers containing special-use address %s', async (address) => {
  spyOn(dns, 'lookup').mockResolvedValue([
    PUBLIC_ADDRESS,
    { address, family: address.includes(':') ? IP_V6 : IP_V4, ttl: 0 },
  ]);
  const send = spyOn(globalThis, 'fetch');
  await expect(fetchClientMetadataResource(METADATA_URL)).rejects.toThrow('public-routable');
  expect(send).not.toHaveBeenCalled();
});

test('rejects an empty DNS answer before connecting', async () => {
  spyOn(dns, 'lookup').mockResolvedValue([]);
  const send = spyOn(globalThis, 'fetch');
  await expect(fetchClientMetadataResource(METADATA_URL)).rejects.toThrow('public-routable');
  expect(send).not.toHaveBeenCalled();
});

test.each([
  { url: 'http://client.invalid/client.json', method: 'GET' },
  { url: 'https://client.invalid/client.json', method: 'POST' },
  { url: 'https://client.invalid/client.json', method: 'PUT' },
])('rejects unsupported requests before DNS: %j', async ({ url, method }) => {
  const resolve = spyOn(dns, 'lookup');
  const send = spyOn(globalThis, 'fetch');
  await expect(fetchClientMetadataResource(url, { method })).rejects.toThrow('HTTPS');
  expect(resolve).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

test('pins an IPv6 address and returns HEAD redirects without following them', async () => {
  const address = '2606:4700:4700::1111';
  spyOn(dns, 'lookup').mockResolvedValue([{ address, family: IP_V6, ttl: 0 }]);
  const redirect = new Response(null, {
    status: StatusMap.Found,
    headers: { location: 'https://127.0.0.1/private' },
  });
  const send = spyOn(globalThis, 'fetch').mockResolvedValue(redirect);
  const response = await fetchClientMetadataResource(new Request(METADATA_URL, { method: 'HEAD' }));
  expect(response).toBe(redirect);
  expect(send).toHaveBeenCalledTimes(1);
  const [url, init] = send.mock.calls[0]!;
  expect(String(url)).toBe(`https://[${address}]:8443/oauth/client.json?version=1`);
  expect(init).toMatchObject({ method: 'HEAD', redirect: 'manual' });
});

test('an aborted request never resolves or connects', async () => {
  const resolve = spyOn(dns, 'lookup');
  const send = spyOn(globalThis, 'fetch');
  await expect(
    fetchClientMetadataResource(METADATA_URL, { signal: AbortSignal.abort() }),
  ).rejects.toThrow();
  expect(resolve).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

test('a request aborted during DNS never connects', async () => {
  const abort = new AbortController();
  spyOn(dns, 'lookup').mockImplementation(function resolveAndAbort() {
    abort.abort();
    return Promise.resolve([PUBLIC_ADDRESS]);
  });
  const send = spyOn(globalThis, 'fetch');
  await expect(
    fetchClientMetadataResource(METADATA_URL, { signal: abort.signal }),
  ).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
