import { describe, expect, test } from 'bun:test';
import { resolveSignInTarget } from '#lib/oauth.ts';

const FALLBACK = '/apps';

describe('resolveSignInTarget', () => {
  test('resumes the authorize request the owner was sent here by', () => {
    const target = resolveSignInTarget({
      search: '?client_id=abc&scope=mcp&callbackURL=%2Flogin',
      fallback: FALLBACK,
    });

    expect(target).toBe('/api/auth/oauth2/authorize?client_id=abc&scope=mcp');
  });

  // The signature is over the parameters better-auth put on the request, and `callbackURL` is not
  // one of them — it is how it asked to be sent back here.
  test('drops only better-auth own way back to this page', () => {
    const target = resolveSignInTarget({ search: '?callbackURL=%2Flogin', fallback: FALLBACK });

    expect(target).toBe(FALLBACK);
  });

  // Repeated keys are how the request is signed, so both copies have to survive in the order they
  // arrived — a parser that collapsed them would hand back a query that no longer verifies.
  test('keeps a repeated parameter as the two it arrived as', () => {
    const target = resolveSignInTarget({
      search: '?ba_param=one&ba_param=two',
      fallback: FALLBACK,
    });

    expect(target).toBe('/api/auth/oauth2/authorize?ba_param=one&ba_param=two');
  });

  test('signing in with nothing to resume lands where it was going', () => {
    expect(resolveSignInTarget({ search: '', fallback: FALLBACK })).toBe(FALLBACK);
  });
});
