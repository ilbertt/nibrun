import { bunSqlAdapter } from '@ilbertt/better-auth-bun-sql';
import { betterAuth } from 'better-auth';
import { sql } from '#db/client.ts';
import { env } from '#lib/env.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';

// Created by src/db/migrations/0002_create_auth_schema.sql — the two have to
// name the same schema.
const AUTH_SCHEMA = 'auth';

/** Bare path; the api controller applies the `/api` prefix it sits under. */
export const AUTH_ROUTE_PATH = '/auth';

export const auth = betterAuth({
  database: bunSqlAdapter({ sql, pgSchema: AUTH_SCHEMA }),
  baseURL: env.BASE_URL.origin,
  basePath: `${RoutePrefix.Api}${AUTH_ROUTE_PATH}`,
  secret: env.BETTER_AUTH_SECRET,
  socialProviders: {
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    },
  },
});
