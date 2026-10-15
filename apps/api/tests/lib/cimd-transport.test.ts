import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { type ClientRequest, type IncomingHttpHeaders, IncomingMessage } from 'node:http';
import * as https from 'node:https';
import { Socket } from 'node:net';
import { type DNSLookup, dns } from 'bun';
import { StatusMap } from 'elysia';
import { fetchClientMetadataResource } from '#lib/auth/cimd-transport.ts';
import { IP_V4, IP_V6 } from '#lib/public-address.ts';

const METADATA_URL = 'https://client.example:8443/oauth/client.json?version=1';
const PUBLIC_ADDRESS: DNSLookup = { address: '1.1.1.1', family: IP_V4, ttl: 0 };

afterEach(function restoreTransportMocks() {
  mock.restore();
});

function mockMetadataResponse({
  status = StatusMap.OK,
  headers = {},
  body = 'metadata',
  error,
}: {
  status?: number;
  headers?: IncomingHttpHeaders;
  body?: string;
  error?: Error;
} = {}) {
  return spyOn(https, 'request').mockImplementation(function requestMetadata(
    ...[, , onResponse]: Parameters<typeof https.request>
  ) {
    const response = new IncomingMessage(new Socket());
    response.statusCode = status;
    response.headers = headers;
    response.push(body);
    response.push(null);
    const request = Object.assign(new EventEmitter(), {
      end() {
        if (error) {
          request.emit('error', error);
        } else {
          onResponse?.(response);
        }
      },
    });
    return request as ClientRequest;
  } as typeof https.request);
}

test('resolves once and pins both lookup callback forms while preserving Host, TLS identity, headers, and signal', async () => {
  const resolve = spyOn(dns, 'lookup').mockResolvedValue([PUBLIC_ADDRESS]);
  const send = mockMetadataResponse({ status: StatusMap['Not Modified'] });
  const abort = new AbortController();
  const response = await fetchClientMetadataResource(METADATA_URL, {
    signal: abort.signal,
    headers: { 'if-none-match': 'cached-version', host: 'untrusted' },
  });
  expect(response.status).toBe(StatusMap['Not Modified']);
  expect(response.body).toBeNull();
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(resolve).toHaveBeenCalledWith('client.example', { family: 0 });
  expect(send).toHaveBeenCalledTimes(1);
  const [url, options] = send.mock.calls[0]!;
  expect(String(url)).toBe(METADATA_URL);
  expect(options.headers).toMatchObject({
    host: 'client.example:8443',
    'if-none-match': 'cached-version',
  });
  expect(options).toMatchObject({ method: 'GET', agent: false, servername: 'client.example' });
  expect(options.signal).toBe(abort.signal);
  const callback = mock();
  options.lookup?.('client.example', { all: true }, callback);
  expect(callback).toHaveBeenLastCalledWith(null, [PUBLIC_ADDRESS]);
  options.lookup?.('client.example', {}, callback);
  expect(callback).toHaveBeenLastCalledWith(null, PUBLIC_ADDRESS.address, PUBLIC_ADDRESS.family);
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
  const send = mockMetadataResponse();
  await expect(fetchClientMetadataResource(METADATA_URL)).rejects.toThrow('public-routable');
  expect(send).not.toHaveBeenCalled();
});

test('rejects an empty DNS answer before connecting', async () => {
  spyOn(dns, 'lookup').mockResolvedValue([]);
  const send = mockMetadataResponse();
  await expect(fetchClientMetadataResource(METADATA_URL)).rejects.toThrow('no DNS addresses');
  expect(send).not.toHaveBeenCalled();
});

test.each([
  { url: 'http://client.invalid/client.json', method: 'GET', message: 'HTTPS' },
  { url: 'https://client.invalid/client.json', method: 'POST', message: 'GET and HEAD' },
  { url: 'https://client.invalid/client.json', method: 'PUT', message: 'GET and HEAD' },
])('rejects unsupported requests before DNS: %j', async ({ url, method, message }) => {
  const resolve = spyOn(dns, 'lookup');
  const send = mockMetadataResponse();
  await expect(fetchClientMetadataResource(url, { method })).rejects.toThrow(message);
  expect(resolve).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

test('pins IPv6 and returns HEAD redirects without following them', async () => {
  const address: DNSLookup = { address: '2606:4700:4700::1111', family: IP_V6, ttl: 0 };
  spyOn(dns, 'lookup').mockResolvedValue([address]);
  const send = mockMetadataResponse({
    status: StatusMap.Found,
    headers: { location: 'https://127.0.0.1/private' },
  });
  const response = await fetchClientMetadataResource(new Request(METADATA_URL, { method: 'HEAD' }));
  expect(response.status).toBe(StatusMap.Found);
  expect(response.headers.get('location')).toBe('https://127.0.0.1/private');
  expect(response.body).toBeNull();
  expect(send).toHaveBeenCalledTimes(1);
  const [, options] = send.mock.calls[0]!;
  expect(options.method).toBe('HEAD');
  const callback = mock();
  options.lookup?.('client.example', { all: true }, callback);
  expect(callback).toHaveBeenCalledWith(null, [address]);
});

test('bridges the upstream response stream and repeated headers', async () => {
  spyOn(dns, 'lookup').mockResolvedValue([PUBLIC_ADDRESS]);
  mockMetadataResponse({ headers: { 'x-metadata': ['first', 'second'] } });
  const response = await fetchClientMetadataResource(METADATA_URL);
  expect(response.headers.get('x-metadata')).toBe('first, second');
  expect(await response.text()).toBe('metadata');
});

test.each([StatusMap['No Content'], StatusMap['Reset Content'], StatusMap['Not Modified']])(
  'omits a body for status %i',
  async (status) => {
    spyOn(dns, 'lookup').mockResolvedValue([PUBLIC_ADDRESS]);
    mockMetadataResponse({ status });
    const response = await fetchClientMetadataResource(METADATA_URL);
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
  },
);

test('propagates request errors', async () => {
  spyOn(dns, 'lookup').mockResolvedValue([PUBLIC_ADDRESS]);
  const error = new Error('connection failed');
  mockMetadataResponse({ error });
  await expect(fetchClientMetadataResource(METADATA_URL)).rejects.toBe(error);
});
