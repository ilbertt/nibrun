import { expect, test } from 'bun:test';
import { ForbiddenError } from '#lib/errors.ts';
import { assertSqliteOrigin } from '#lib/sqlite/http.ts';

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
