import { expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { SignInProvider } from '@repo/api-constants';
import { betterAuth } from 'better-auth';
import { type MemoryDB, memoryAdapter } from 'better-auth/adapters/memory';
import { getSchema } from 'better-auth/db';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { chatGptLogin, discardChatGptTokens } from '#lib/auth/chatgpt.ts';

const ORIGIN = 'https://nibrun.test';
const ISSUER = 'https://auth.openai.com';
const CALLBACK = `${ORIGIN}/api/auth/callback/chatgpt`;
const CREDENTIALS = { clientId: 'test-client', clientSecret: 'test-secret' };

test('ChatGPT website sign-in verifies the identity token and keeps only its account binding', async () => {
  const db: MemoryDB = {};
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };
  let authorization = new URLSearchParams();
  let nonce = '';
  let emailVerified = true;
  const issuerFetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async function respond(...[input, init]: Parameters<typeof fetch>) {
        const url = input instanceof Request ? input.url : String(input);
        switch (url) {
          case `${ISSUER}/.well-known/openid-configuration`:
            return Response.json({
              issuer: ISSUER,
              authorization_endpoint: `${ISSUER}/authorize`,
              token_endpoint: `${ISSUER}/token`,
              jwks_uri: `${ISSUER}/keys`,
              id_token_signing_alg_values_supported: ['RS256'],
            });
          case `${ISSUER}/keys`:
            return Response.json({ keys: [jwk] });
          case `${ISSUER}/token`: {
            const form = new URLSearchParams(
              input instanceof Request ? await input.text() : String(init?.body),
            );
            const verifier = form.get('code_verifier');
            expect(verifier).toBeTruthy();
            expect(
              createHash('sha256')
                .update(verifier ?? '')
                .digest('base64url'),
            ).toBe(authorization.get('code_challenge') ?? '');
            expect(form.get('redirect_uri')).toBe(CALLBACK);
            expect(form.get('client_id')).toBe(CREDENTIALS.clientId);
            expect(form.has('client_secret')).toBe(false);
            expect(
              new Headers(
                init?.headers ?? (input instanceof Request ? input.headers : undefined),
              ).get('authorization'),
            ).toBe(`Basic ${btoa('test-client:test-secret')}`);
            const token = await new SignJWT({
              email: 'owner@example.test',
              email_verified: emailVerified,
              nonce,
            })
              .setProtectedHeader({ alg: 'RS256', kid: 'test' })
              .setIssuer(ISSUER)
              .setAudience(CREDENTIALS.clientId)
              .setSubject('subject')
              .setIssuedAt()
              .setExpirationTime('5m')
              .sign(privateKey);
            return Response.json({ id_token: token });
          }
          default:
            throw new Error(`Unexpected provider request to ${url}`);
        }
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    const auth = betterAuth({
      baseURL: ORIGIN,
      database: memoryAdapter(db),
      secret: crypto.randomUUID(),
      plugins: [chatGptLogin(CREDENTIALS)],
      databaseHooks: {
        account: {
          create: { before: discardChatGptTokens },
          update: { before: discardChatGptTokens },
        },
      },
    });
    for (const table of Object.keys(getSchema(auth.options))) {
      db[table] = [];
    }
    for (const attempt of ['sign up', 'return', 'wrong nonce', 'unverified email']) {
      const start = await auth.api.signInSocial({
        body: { provider: SignInProvider.ChatGPT, callbackURL: ORIGIN },
        returnHeaders: true,
      });
      authorization = new URL(start.response.url ?? '').searchParams;
      expect(authorization.get('code_challenge_method')).toBe('S256');
      expect(authorization.get('scope')?.split(' ').sort()).toEqual(['email', 'openid', 'profile']);
      expect(authorization.get('redirect_uri')).toBe(CALLBACK);
      expect(authorization.get('nonce')).toBeTruthy();
      nonce = attempt === 'wrong nonce' ? 'incorrect' : (authorization.get('nonce') ?? '');
      emailVerified = attempt !== 'unverified email';
      const state = authorization.get('state');
      expect(state).toBeTruthy();
      const callback = new URL(CALLBACK);
      callback.search = new URLSearchParams({ code: 'test-code', state: state ?? '' }).toString();
      const cookie = start.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
      const response = await auth.handler(new Request(callback.href, { headers: { cookie } }));
      if (attempt === 'sign up' || attempt === 'return') {
        expect(response.headers.get('location')).toBe(ORIGIN);
      } else {
        expect(response.headers.get('location')).toContain('error=');
      }
    }
    expect(db.user).toHaveLength(1);
    expect(db.session).toHaveLength(2);
    expect(db.account).toHaveLength(1);
    expect(db.account?.[0]).toMatchObject({
      providerId: SignInProvider.ChatGPT,
      accountId: JSON.stringify([ISSUER, CREDENTIALS.clientId, 'subject']),
    });
    expect(db.account?.[0]?.idToken ?? null).toBeNull();
  } finally {
    issuerFetch.mockRestore();
  }
});
