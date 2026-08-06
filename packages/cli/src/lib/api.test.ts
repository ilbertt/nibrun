import { expect, test } from 'bun:test';
import { authHeaders, describeFailure } from '#lib/api.ts';

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

test('a refusal is reported as the api answering, not as this program deciding', () => {
  const failure = Object.assign(new Error('[object Object]'), {
    status: 404,
    value: { error: 'Not Found' },
  });

  expect(describeFailure(failure)).toBe('The api answered 404: Not Found');
});

test('a body that names no error is still worth repeating', () => {
  const failure = Object.assign(new Error('nope'), { status: 500, value: 'nope' });

  expect(describeFailure(failure)).toBe('The api answered 500: nope');
});

// Eden reports a request it never sent as a 503 of its own, and saying the api answered it would
// blame a server that was never reached.
test('an api that could not be reached is not one that answered', () => {
  const failure = Object.assign(new Error('unreachable'), {
    status: 503,
    value: new TypeError('Unable to connect'),
  });

  expect(describeFailure(failure)).toBe('Unable to connect');
});
