import { expect, test } from 'bun:test';
import { requireSignedIn } from '#lib/credentials.ts';

const API_URL = 'http://localhost:3000';

test('a token for this api is what being signed in means', () => {
  expect(() =>
    requireSignedIn({
      apiUrl: API_URL,
      credentials: { apiUrl: API_URL, accessToken: 'abc' },
    }),
  ).not.toThrow();
});

test('having never signed in says how to', () => {
  expect(() => requireSignedIn({ apiUrl: API_URL, credentials: null })).toThrow(
    'Not signed in. Run `nib login`.',
  );
});

test('a session belonging to another api is named rather than silently refused', () => {
  expect(() =>
    requireSignedIn({
      apiUrl: API_URL,
      credentials: { apiUrl: 'https://nibrun.test', accessToken: 'abc' },
    }),
  ).toThrow('Signed in to https://nibrun.test, not http://localhost:3000');
});
