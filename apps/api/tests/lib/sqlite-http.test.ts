import { expect, test } from 'bun:test';
import { ForbiddenError } from '#lib/errors.ts';
import { assertSqliteCookieOrigin, assertSqliteOrigin } from '#lib/sqlite/http.ts';

const ALLOWED_ORIGIN = 'https://api.test';

test('SQLite accepts same-origin browser requests and authenticated CLI requests without Origin', () => {
  const browserRequest = new Request(ALLOWED_ORIGIN, { headers: { origin: ALLOWED_ORIGIN } });
  const cliRequest = new Request(ALLOWED_ORIGIN);
  for (const request of [browserRequest, cliRequest]) {
    assertSqliteOrigin({ request, allowedOrigin: ALLOWED_ORIGIN });
  }
});

test('SQLite rejects cross-origin and opaque-origin browser requests', () => {
  for (const origin of ['https://other.test', 'null']) {
    expect(function rejectOrigin() {
      assertSqliteOrigin({
        request: new Request(ALLOWED_ORIGIN, { headers: { origin } }),
        allowedOrigin: ALLOWED_ORIGIN,
      });
    }).toThrow(ForbiddenError);
  }
});

test('SQLite cookie-origin checks do not inspect authorization headers', () => {
  for (const authorization of [
    undefined,
    'Bearer ',
    'Basic account-session',
    'Bearer account-session',
  ]) {
    const headers = new Headers({ origin: 'https://client.test' });
    if (authorization !== undefined) {
      headers.set('authorization', authorization);
    }
    assertSqliteCookieOrigin({
      request: new Request(ALLOWED_ORIGIN, { headers }),
      allowedOrigin: ALLOWED_ORIGIN,
    });
  }
});

test('SQLite rejects cross-origin session cookies even when an authorization header is present', () => {
  for (const origin of ['https://client.test', 'null']) {
    expect(function rejectCrossOriginCookies() {
      assertSqliteCookieOrigin({
        request: new Request(ALLOWED_ORIGIN, {
          headers: {
            origin,
            authorization: 'Bearer account-session',
            cookie: 'session=account-session',
          },
        }),
        allowedOrigin: ALLOWED_ORIGIN,
      });
    }).toThrow(ForbiddenError);
  }
});

test('same-origin SQLite clients retain cookie authentication', () => {
  assertSqliteCookieOrigin({
    request: new Request(ALLOWED_ORIGIN, {
      headers: { origin: ALLOWED_ORIGIN, cookie: 'session=account-session' },
    }),
    allowedOrigin: ALLOWED_ORIGIN,
  });
});
