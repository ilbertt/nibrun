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

const DEVICE_VERIFICATION_PATH = '/device';

/**
 * A factory rather than an instance, so that what better-auth is given to call back into is
 * handed to it where the rest of the graph is wired — `src/services/plugins.ts` — rather than
 * reached for from here. The one instance the api serves is made there; the schema the CLI
 * prints is read off another, in `scripts/auth-schema.ts`, with nothing behind it.
 */
export function createAuth() {
  return betterAuth({
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
    plugins: [deviceAuthorization({ verificationUri: DEVICE_VERIFICATION_PATH }), bearer()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
