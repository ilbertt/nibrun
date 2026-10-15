import { expect, test } from 'bun:test';
import { mcpConsentOutcome } from '#lib/mcp-consent-outcome.ts';

test('authorization is counted only after the response includes an issued code', () => {
  expect(
    mcpConsentOutcome({
      accept: true,
      data: { redirect: true, url: 'https://client.test/callback?code=private-code' },
    }),
  ).toBe('approved');
  for (const url of [
    'https://client.test/callback',
    'https://client.test/callback?code=',
    'https://client.test/callback?error=invalid_request',
    'https://client.test/callback?code=code&error=invalid_scope',
    'invalid-url',
  ]) {
    expect(mcpConsentOutcome({ accept: true, data: { redirect: true, url } })).toBe('failed');
  }
});

test('a refusal requires the matching access-denied response', () => {
  expect(
    mcpConsentOutcome({
      accept: false,
      data: { redirect: true, url: 'https://client.test/callback?error=access_denied' },
    }),
  ).toBe('denied');
  expect(
    mcpConsentOutcome({
      accept: true,
      data: { redirect: true, url: 'https://client.test/callback?error=access_denied' },
    }),
  ).toBe('failed');
  expect(
    mcpConsentOutcome({
      accept: false,
      data: { redirect: true, url: 'https://client.test/callback?code=private-code' },
    }),
  ).toBe('failed');
});
