import { expect, mock, test } from 'bun:test';
import { StatusMap } from 'elysia';
import {
  CimdMetadataRepository,
  type CimdMetadataRequest,
} from '#repositories/cimd-metadata.repository.ts';

const METADATA_URL = 'https://client.example:8443/oauth/client.json?version=1';
const PUBLIC_ADDRESS = '1.1.1.1';

test('resolves once and pins the connection while preserving Host, TLS identity, and cache headers', async () => {
  const resolve = mock(function resolveClient(host: string) {
    expect(host).toBe('client.example');
    return Promise.resolve([PUBLIC_ADDRESS]);
  });
  const abort = new AbortController();
  const fetch = mock(function fetchMetadata({ url, init }: CimdMetadataRequest) {
    expect(url.href).toBe('https://1.1.1.1:8443/oauth/client.json?version=1');
    const headers = new Headers(init.headers);
    expect(headers.get('host')).toBe('client.example:8443');
    expect(headers.get('if-none-match')).toBe('cached-version');
    expect(init.tls).toMatchObject({ serverName: 'client.example' });
    expect(init).toMatchObject({
      redirect: 'manual',
      proxy: false,
      keepalive: false,
      method: 'GET',
    });
    abort.abort();
    expect(init.signal?.aborted).toBe(true);
    return Promise.resolve(new Response(null, { status: 304 }));
  });
  const repository = new CimdMetadataRepository({ resolve, fetch });
  const response = await repository.fetch({
    input: METADATA_URL,
    init: {
      signal: abort.signal,
      headers: { 'if-none-match': 'cached-version', host: 'untrusted' },
    },
  });
  expect(response.status).toBe(StatusMap['Not Modified']);
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([
  '127.0.0.1',
  '10.0.0.1',
  '169.254.169.254',
  '192.0.2.1',
  '::1',
  '::ffff:127.0.0.1',
  '2001:db8::1',
])(
  'rejects every special-use address, including mixed DNS answers containing %s',
  async (address) => {
    const fetch = mock(function unexpectedFetch() {
      throw new Error('Private addresses must never be dialled.');
    });
    const repository = new CimdMetadataRepository({
      resolve() {
        return Promise.resolve([PUBLIC_ADDRESS, address]);
      },
      fetch,
    });
    await expect(repository.fetch({ input: METADATA_URL, init: undefined })).rejects.toThrow(
      'public',
    );
    expect(fetch).not.toHaveBeenCalled();
  },
);

test.each(['http://client.example/client.json', 'https://client.example/client.json'])(
  'rejects unsupported requests before resolving %s',
  async (url) => {
    const resolve = mock(function unexpectedResolve() {
      throw new Error('The request must be rejected before DNS.');
    });
    const repository = new CimdMetadataRepository({ resolve });
    await expect(repository.fetch({ input: url, init: { method: 'POST' } })).rejects.toThrow(
      'HTTPS',
    );
    expect(resolve).not.toHaveBeenCalled();
  },
);

test('returns redirects without following them', async () => {
  const fetch = mock(function redirect() {
    return Promise.resolve(
      new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }),
    );
  });
  const repository = new CimdMetadataRepository({
    resolve() {
      return Promise.resolve([PUBLIC_ADDRESS]);
    },
    fetch,
  });
  const response = await repository.fetch({ input: METADATA_URL, init: { method: 'HEAD' } });
  expect(response.status).toBe(StatusMap.Found);
  expect(fetch).toHaveBeenCalledTimes(1);
});
