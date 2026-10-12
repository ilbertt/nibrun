import { AUTH_BASE_PATH, AUTH_JWKS_PATH } from '#lib/auth/paths.ts';
import { env } from '#lib/env.ts';

export const OAUTH_ISSUER = env.BASE_URL.origin;
export const OAUTH_JWKS_URL = `${OAUTH_ISSUER}${AUTH_BASE_PATH}${AUTH_JWKS_PATH}`;
