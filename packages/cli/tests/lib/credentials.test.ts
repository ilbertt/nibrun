import { expect, test } from 'bun:test';
import type { Credentials } from '#lib/credentials.ts';
import { requireSignedIn } from '#lib/credentials.ts';

const API_URL = 'http://localhost:3000';

function stored(credentials: Credentials | null) {
  return { credentials: { maybeRead: () => Promise.resolve(credentials) } };
}

test('a token for this api is what being signed in means', async () => {
  const gate = requireSignedIn({
    apiUrl: API_URL,
    apiKey: undefined,
    files: stored({ apiUrl: API_URL, accessToken: 'abc' }),
  });

  await expect(gate).resolves.toBeUndefined();
});

test('having never signed in says how to', async () => {
  const gate = requireSignedIn({ apiUrl: API_URL, apiKey: undefined, files: stored(null) });

  await expect(gate).rejects.toThrow('Not signed in. Run `nib login` or set NIBRUN_API_KEY.');
});

test('a session belonging to another api is named rather than silently refused', async () => {
  const gate = requireSignedIn({
    apiUrl: API_URL,
    apiKey: undefined,
    files: stored({ apiUrl: 'https://nibrun.test', accessToken: 'abc' }),
  });

  await expect(gate).rejects.toThrow('Signed in to https://nibrun.test, not http://localhost:3000');
});

test('a CI key passes the login gate without reading the credential store', async () => {
  await expect(
    requireSignedIn({
      apiUrl: API_URL,
      apiKey: 'nib_ci',
      files: {
        credentials: { maybeRead: () => Promise.reject(new Error('Must not read local login')) },
      },
    }),
  ).resolves.toBeUndefined();
});
