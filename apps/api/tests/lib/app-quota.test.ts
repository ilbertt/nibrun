import { expect, test } from 'bun:test';
import { HELLO_EMAIL } from '@repo/global-constants';
import { AppQuotaRefusalSchema, Value } from '@repo/protocol';
import { StatusMap } from 'elysia';
import { AppQuotaError } from '#lib/app-quota.ts';

const ALLOWED = 3;
const NONE = 0;

test('the body is what a client is promised: the sentence and the number it names', () => {
  const body = new AppQuotaError(ALLOWED).body();

  expect(Value.Check(AppQuotaRefusalSchema, body)).toBe(true);
  expect(body.appsAllowed).toBe(ALLOWED);
});

test('the sentence names the limit and the address to ask for more at', () => {
  const refused = new AppQuotaError(ALLOWED);

  expect(refused.statusCode).toBe(StatusMap.Forbidden);
  expect(refused.message).toContain(`can have ${ALLOWED} apps`);
  expect(refused.message).toContain(HELLO_EMAIL);
});

test('an account allowed none is told that, with no number to read as room', () => {
  const refused = new AppQuotaError(NONE);

  expect(refused.message).toBe('This account cannot create apps.');
  expect(refused.body().appsAllowed).toBe(NONE);
});
