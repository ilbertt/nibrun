import { expect, test } from 'bun:test';
import { authHeaders } from '#lib/api.ts';

test('a session token is sent as the cookie better-auth issued', () => {
  expect(authHeaders({ baseUrl: 'http://localhost:3000', cookieToken: 'abc' })).toEqual({
    cookie: 'better-auth.session_token=abc',
  });
});

test('an api served over https is sent the prefixed name it set the cookie under', () => {
  expect(authHeaders({ baseUrl: 'https://nibrun.test', cookieToken: 'abc' })).toEqual({
    cookie: '__Secure-better-auth.session_token=abc',
  });
});

test('naming no credential is refused before anything is sent', () => {
  expect(() => authHeaders({ baseUrl: 'http://localhost:3000' })).toThrow('NIBRUN_COOKIE_TOKEN');
});

test('a variable set to nothing is a variable not set', () => {
  expect(() => authHeaders({ baseUrl: 'http://localhost:3000', cookieToken: '' })).toThrow(
    'NIBRUN_COOKIE_TOKEN',
  );
});
