import { expect, test } from 'bun:test';
import { signInFailureData } from '#lib/sign-in-failure.ts';

const HTTP_STATUS = {
  ok: 200,
  belowErrorRange: 399,
  badRequest: 400,
  forbidden: 403,
  nonInteger: 403.5,
  tooManyRequests: 429,
  internalServerError: 500,
  lastServerError: 599,
  aboveErrorRange: 600,
};

test('auth failures retain a published error code and HTTP status without raw details', () => {
  expect(
    signInFailureData({
      code: 'INVALID_ORIGIN',
      status: 403,
      statusText: 'Forbidden: https://private.example',
      message: 'Private email: private@example.com',
      body: { access_token: 'SECRET' },
      stack: 'Private file path',
    }),
  ).toEqual({ error_code: 'INVALID_ORIGIN', http_status: 403 });
});

test('unknown codes and inherited object keys cannot leak into analytics', () => {
  for (const code of [
    'PRIVATE_TOKEN',
    'private@example.com',
    'constructor',
    '__proto__',
    {},
    HTTP_STATUS.forbidden,
  ]) {
    expect(signInFailureData({ code, status: 429 })).toEqual({
      error_code: undefined,
      http_status: 429,
    });
  }
});

test('invalid statuses are dropped independently of a known auth code', () => {
  for (const status of [
    undefined,
    null,
    '403',
    0,
    HTTP_STATUS.ok,
    HTTP_STATUS.belowErrorRange,
    HTTP_STATUS.aboveErrorRange,
    HTTP_STATUS.nonInteger,
    Number.NaN,
    Infinity,
  ]) {
    expect(signInFailureData({ code: 'INVALID_ORIGIN', status })).toEqual({
      error_code: 'INVALID_ORIGIN',
      http_status: undefined,
    });
  }
  for (const status of [
    HTTP_STATUS.badRequest,
    HTTP_STATUS.tooManyRequests,
    HTTP_STATUS.internalServerError,
    HTTP_STATUS.lastServerError,
  ]) {
    expect(signInFailureData({ status })).toEqual({ error_code: undefined, http_status: status });
  }
});

test('network errors and unexpected thrown values do not produce invented HTTP statuses', () => {
  for (const error of [
    new TypeError('Failed to fetch https://private.example?token=SECRET'),
    new DOMException('Private request details', 'AbortError'),
    new Error('private@example.com'),
    'SECRET',
    undefined,
    null,
    HTTP_STATUS.forbidden,
    {},
  ]) {
    expect(signInFailureData(error)).toEqual({ error_code: undefined, http_status: undefined });
  }
});
