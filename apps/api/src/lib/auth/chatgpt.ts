import { SignInProvider } from '@repo/api-constants';
import type { Account } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { type GenericOAuthConfig, genericOAuth } from 'better-auth/plugins/generic-oauth';
import { decodeJwt } from 'jose';

import type { env } from '#lib/env.ts';

type WebsiteClient = NonNullable<typeof env.CHATGPT_CLIENT>;

const ISSUER = 'https://auth.openai.com';

function chatGptProvider({
  clientId,
  clientSecret,
}: WebsiteClient): GenericOAuthConfig<SignInProvider.ChatGPT> {
  return {
    providerId: SignInProvider.ChatGPT,
    clientId,
    clientSecret,
    discoveryUrl: `${ISSUER}/.well-known/openid-configuration`,
    requireIdTokenVerification: true,
    authentication: 'basic',
    tokenUrlParams: { client_id: clientId },
    scopes: ['openid', 'profile', 'email'],
    getUserInfo({ idToken }) {
      // Generic OAuth verifies the signature and transaction nonce before calling this hook.
      const claims = idToken ? decodeJwt(idToken) : undefined;
      if (
        claims?.iss !== ISSUER ||
        typeof claims.sub !== 'string' ||
        !claims.sub.trim() ||
        typeof claims.email !== 'string' ||
        !claims.email.trim() ||
        claims.email_verified !== true
      ) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        sub: claims.sub,
        email: claims.email,
        emailVerified: true,
        name: typeof claims.name === 'string' ? claims.name : claims.email,
      });
    },
    accountSubject({ profile }) {
      return JSON.stringify([ISSUER, clientId, profile.sub]);
    },
  };
}

export function chatGptLogin(credentials: WebsiteClient | undefined) {
  const plugin = genericOAuth({ config: credentials ? [chatGptProvider(credentials)] : [] });
  plugin.hooks.before.push({
    matcher: (ctx) =>
      (ctx.path === '/sign-in/social' || ctx.path === '/link-social') &&
      ctx.body?.provider === SignInProvider.ChatGPT &&
      Boolean(ctx.body.idToken),
    handler: createAuthMiddleware(() => {
      throw new APIError('BAD_REQUEST', { message: 'Start ChatGPT sign-in in the browser.' });
    }),
  });
  return plugin;
}

export function discardChatGptTokens(account: Partial<Account>) {
  return Promise.resolve(
    account.providerId === SignInProvider.ChatGPT
      ? { data: { idToken: null, accessToken: null, refreshToken: null } }
      : undefined,
  );
}
