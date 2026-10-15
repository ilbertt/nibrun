import { expect, mock, test } from 'bun:test';
import {
  ClientWebsiteRepository,
  MAX_CLIENT_WEBSITE_HTML_BYTES,
} from '#repositories/client-website.repository.ts';

test('follows redirects through the pinned transport and retains the final page URL', async () => {
  const fetchResource = mock()
    .mockResolvedValueOnce(Response.redirect('https://client.example/login'))
    .mockResolvedValueOnce(
      new Response('<head></head>', { headers: { 'content-type': 'text/html' } }),
    );
  const repo = new ClientWebsiteRepository({ fetchResource });
  expect(await repo.read({ url: 'https://client.example/' })).toEqual({
    url: new URL('https://client.example/login'),
    html: '<head></head>',
  });
  expect(fetchResource).toHaveBeenCalledTimes(2);
  const firstOptions = fetchResource.mock.calls[0]![1];
  expect(firstOptions).toMatchObject({
    redirect: 'manual',
    headers: { accept: 'text/html,application/xhtml+xml' },
  });
  expect(firstOptions.signal).toBe(fetchResource.mock.calls[1]![1].signal);
});

test.each(['http://private.example/', 'https://user:password@client.example/'])(
  'refuses an unsafe redirect before requesting it: %s',
  async (target) => {
    const fetchResource = mock().mockResolvedValue(Response.redirect(target));
    const repo = new ClientWebsiteRepository({ fetchResource });
    expect(await repo.read({ url: 'https://client.example/' })).toBeNull();
    expect(fetchResource).toHaveBeenCalledTimes(1);
  },
);

test('bounds redirect loops', async () => {
  const fetchResource = mock(function redirect() {
    return Promise.resolve(Response.redirect('https://client.example/loop'));
  });
  const repo = new ClientWebsiteRepository({ fetchResource });
  expect(await repo.read({ url: 'https://client.example/' })).toBeNull();
  const MAX_REQUESTS = 4;
  expect(fetchResource).toHaveBeenCalledTimes(MAX_REQUESTS);
});

test('cancels oversized pages after reading a bounded prefix', async () => {
  const cancel = mock();
  const MAX_READS = 2;
  let reads = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads++;
      controller.enqueue(new Uint8Array(MAX_CLIENT_WEBSITE_HTML_BYTES).fill('x'.charCodeAt(0)));
    },
    cancel,
  });
  const fetchResource = mock().mockResolvedValue(
    new Response(body, { headers: { 'content-type': 'text/html' } }),
  );
  const page = await new ClientWebsiteRepository({ fetchResource }).read({
    url: 'https://client.example/',
  });
  expect(page?.html.length).toBe(MAX_CLIENT_WEBSITE_HTML_BYTES);
  expect(reads).toBeLessThanOrEqual(MAX_READS);
  expect(cancel).toHaveBeenCalled();
});

test('does not read non-HTML responses', async () => {
  const fetchResource = mock().mockResolvedValue(Response.json({ not: 'a page' }));
  const repo = new ClientWebsiteRepository({ fetchResource });
  expect(await repo.read({ url: 'https://client.example/' })).toBeNull();
});
