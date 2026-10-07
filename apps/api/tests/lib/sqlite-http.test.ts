import { expect, test } from 'bun:test';
import { ForbiddenError } from '#lib/errors.ts';
import { assertSqliteClientOrigin, assertSqliteOrigin } from '#lib/sqlite/http.ts';

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

test('SQLite clients can supply a bearer token from any browser origin', () => {
  assertSqliteClientOrigin({
    request: new Request(ALLOWED_ORIGIN, {
      headers: { origin: 'https://client.test', authorization: 'Bearer account-session' },
    }),
    allowedOrigin: ALLOWED_ORIGIN,
  });
});

test('cross-origin SQLite clients cannot authenticate through cookies or malformed bearer headers', () => {
  const deniedHeaders: Record<string, string>[] = [
    { origin: 'https://client.test' },
    { origin: 'https://client.test', authorization: 'Bearer ' },
    { origin: 'https://client.test', authorization: 'Basic account-session' },
    {
      origin: 'https://client.test',
      authorization: 'Bearer account-session',
      cookie: 'session=account-session',
    },
    { origin: 'null', authorization: 'Bearer account-session' },
  ];
  for (const headers of deniedHeaders) {
    expect(function rejectBrowserCredentials() {
      assertSqliteClientOrigin({
        request: new Request(ALLOWED_ORIGIN, { headers }),
        allowedOrigin: ALLOWED_ORIGIN,
      });
    }).toThrow(ForbiddenError);
  }
});

test('same-origin SQLite clients retain cookie authentication', () => {
  assertSqliteClientOrigin({
    request: new Request(ALLOWED_ORIGIN, {
      headers: { origin: ALLOWED_ORIGIN, cookie: 'session=account-session' },
    }),
    allowedOrigin: ALLOWED_ORIGIN,
  });
});
