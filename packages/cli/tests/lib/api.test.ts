import { expect, test } from 'bun:test';
import { authHeaders } from '#lib/api.ts';

const API_URL = 'http://localhost:3000';

test('a stored token authenticates as the bearer it is', () => {
  expect(
    authHeaders({
      baseUrl: API_URL,
      credentials: { apiUrl: API_URL, accessToken: 'abc' },
    }),
  ).toEqual({ authorization: 'Bearer abc' });
});

test('a token issued by another api is not sent to this one', () => {
  expect(
    authHeaders({
      baseUrl: API_URL,
      credentials: { apiUrl: 'https://nibrun.test', accessToken: 'abc' },
    }),
  ).toEqual({});
});

// `nib login` is dispatched like any other command, so building the client must survive having
// nothing to authenticate with.
test('being signed out builds a client rather than refusing to', () => {
  expect(authHeaders({ baseUrl: API_URL, credentials: null })).toEqual({});
});
