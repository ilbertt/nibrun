import { expect, test } from 'bun:test';
import { AppIdSchema, TimestampSchema } from '@repo/api-client/validation';
import { Value } from '@sinclair/typebox/value';
import { SessionIdentity } from '#lib/session-identity.ts';
import { consumeSignIn, verifiedClaims } from '#lib/sign-in-analytics.ts';

const APP_ID = Value.Parse(AppIdSchema, '00000000-0000-4000-8000-000000000001');
const OTHER_APP_ID = Value.Parse(AppIdSchema, '00000000-0000-4000-8000-000000000002');
const SIGN_IN_WINDOW_MS = 60_000;

test('a sign-in return is consumed once and accepts only app identifiers', () => {
  let stored: string | null = JSON.stringify({
    reason: 'keep-app',
    previous_identity_state: SessionIdentity.Anonymous,
    expires_at: Date.now() + SIGN_IN_WINDOW_MS,
    anonymous_app_ids: [APP_ID, null],
  });
  const storage = {
    getItem() {
      return stored;
    },
    removeItem() {
      stored = null;
    },
  };
  expect(consumeSignIn(storage)).toMatchObject({
    previous_identity_state: SessionIdentity.Anonymous,
    anonymous_app_ids: [APP_ID],
  });
  expect(consumeSignIn(storage)).toBeUndefined();
});

test('expired and malformed sign-in records cannot create conversions', () => {
  for (const stored of [
    '{invalid',
    JSON.stringify({ reason: 'keep-app', expires_at: 0, anonymous_app_ids: [APP_ID] }),
    JSON.stringify({
      reason: 'unknown',
      expires_at: Date.now() + SIGN_IN_WINDOW_MS,
      anonymous_app_ids: [],
    }),
    JSON.stringify({
      reason: 'login',
      previous_identity_state: 'invalid',
      expires_at: Date.now() + SIGN_IN_WINDOW_MS,
      anonymous_app_ids: [],
    }),
  ]) {
    expect(consumeSignIn({ getItem: () => stored, removeItem() {} })).toBeUndefined();
  }
});

test('visitor sign-ins and records created before identity tracking are not anonymous conversions', () => {
  for (const identity of [SessionIdentity.Visitor, undefined]) {
    const stored = JSON.stringify({
      reason: 'login',
      previous_identity_state: identity,
      expires_at: Date.now() + SIGN_IN_WINDOW_MS,
      anonymous_app_ids: [],
    });
    expect(consumeSignIn({ getItem: () => stored, removeItem() {} })?.previous_identity_state).toBe(
      identity,
    );
  }
});

test('a claim requires the same anonymous app to become permanent under the account', () => {
  const pending = {
    reason: 'keep-app' as const,
    previous_identity_state: SessionIdentity.Anonymous,
    expires_at: Date.now() + SIGN_IN_WINDOW_MS,
    anonymous_app_ids: [APP_ID],
  };
  expect(verifiedClaims({ pending, apps: [{ id: OTHER_APP_ID, expiresAt: null }] })).toEqual([]);
  expect(
    verifiedClaims({
      pending,
      apps: [{ id: APP_ID, expiresAt: Value.Parse(TimestampSchema, new Date().toISOString()) }],
    }),
  ).toEqual([]);
  expect(verifiedClaims({ pending, apps: [{ id: APP_ID, expiresAt: null }] })).toEqual([APP_ID]);
});
