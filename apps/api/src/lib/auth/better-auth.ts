import { bunSqlAdapter } from '@ilbertt/better-auth-bun-sql';
import { betterAuth } from 'better-auth';
import { bearer, deviceAuthorization } from 'better-auth/plugins';
import { sql } from '#db/client.ts';
import { env } from '#lib/env.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';

const AUTH_SCHEMA = 'auth';

/** Bare path; the api controller applies the `/api` prefix it sits under. */
export const AUTH_ROUTE_PATH = '/auth';
const AUTH_BASE_PATH = `${RoutePrefix.Api}${AUTH_ROUTE_PATH}`;

/**
 * Where an owner approves a waiting CLI. Relative, so better-auth resolves it against the same
 * base URL it serves everything else under — which is the dashboard's origin too, and the reason
 * a route the dashboard owns can be named from here at all.
 */
export const DEVICE_VERIFICATION_PATH = '/device';

export const auth = betterAuth({
  database: bunSqlAdapter({ sql, pgSchema: AUTH_SCHEMA }),
  baseURL: env.BASE_URL.origin,
  basePath: AUTH_BASE_PATH,
  secret: env.BETTER_AUTH_SECRET,
  socialProviders: {
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    },
  },
  plugins: [
    // A CLI has no browser to be redirected and nowhere to keep a cookie. It shows a code
    // instead, the owner approves it where they are already signed in, and a session is issued
    // to the CLI rather than borrowed from the browser that approved it.
    deviceAuthorization({ verificationUri: DEVICE_VERIFICATION_PATH }),
    // What makes that session usable by something with no cookie jar: the device flow hands back
    // a token, and this is what reads one back off an `Authorization` header. Without it the
    // token the CLI is issued would authenticate nothing.
    bearer(),
  ],
});
