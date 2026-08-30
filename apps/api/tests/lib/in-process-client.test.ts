import { expect, test } from 'bun:test';
import { createInProcessPublicApiClient } from '@repo/api-client/public';
import { Elysia } from 'elysia';

function anApi() {
  return new Elysia().get('/who', ({ headers }) => ({ saw: headers.authorization ?? null }));
}

type WhoClient = { who: { get: () => Promise<{ data: { saw: string | null } | null }> } };

/**
 * The property the whole arrangement rests on: a caller inside the api reaches it without the
 * request leaving the process. Nothing is listening on a socket here, so a client that dialled one
 * could not answer at all.
 */
test('a client given the app answers without a server listening anywhere', async () => {
  const client = createInProcessPublicApiClient({ app: anApi() }) as unknown as WhoClient;

  const { data } = await client.who.get();

  expect(data?.saw).toBeNull();
});

// What makes it safe to be inside: the request runs the routes as they are, credential and all,
// rather than skipping past them because the caller happens to be in the same process.
test('the credential it carries arrives as a header the routes can read', async () => {
  const client = createInProcessPublicApiClient({
    app: anApi(),
    headers: { authorization: 'Bearer a-token' },
  }) as unknown as WhoClient;

  const { data } = await client.who.get();

  expect(data?.saw).toBe('Bearer a-token');
});
