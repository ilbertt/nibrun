import { oauthProvider } from '@better-auth/oauth-provider';
import { bunSqlAdapter } from '@ilbertt/better-auth-bun-sql';
import { betterAuth } from 'better-auth';
import { bearer, deviceAuthorization, jwt } from 'better-auth/plugins';
import { sql } from '#db/client.ts';
import { env } from '#lib/env.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';

const AUTH_SCHEMA = 'auth';

/** Bare path; the api controller applies the `/api` prefix it sits under. */
export const AUTH_ROUTE_PATH = '/auth';
const AUTH_BASE_PATH = `${RoutePrefix.Api}${AUTH_ROUTE_PATH}`;

const DEVICE_VERIFICATION_PATH = '/device';

// Routes of the dashboard, which is served at the root origin: better-auth sends the owner to
// these and they read the authorize query it appends. Both are the paths the dashboard's own
// router declares, so renaming a route there means renaming it here.
const SIGN_IN_PATH = '/login';
const CONSENT_PATH = '/consent';

/**
 * What a token is issued for, per RFC 8707. The endpoint's own url, because that is what a client
 * asks for and what the endpoint has to recognise as itself — taken from the prefix the api serves
 * it at rather than written out again, so the two cannot drift.
 */
const MCP_RESOURCE = new URL(RoutePrefix.Mcp, env.BASE_URL).href;

/**
 * The one scope worth naming, and it is coarse on purpose: every tool the MCP server offers acts
 * as the owner, up to and including deleting an app. Splitting it into read and write would be a
 * promise nothing enforces yet, which is worse than a scope that says plainly what it grants.
 *
 * No `openid`. This is an OAuth 2.1 authorization server and not an OIDC provider — MCP asks for
 * an access token and never for an identity token, and advertising `openid` would commit us to
 * claims nothing reads.
 */
export const MCP_SCOPE = 'mcp';

const OAUTH_SCOPES = ['offline_access', MCP_SCOPE];

export const auth = betterAuth({
  database: bunSqlAdapter({ sql, pgSchema: AUTH_SCHEMA }),
  baseURL: env.BASE_URL.origin,
  basePath: AUTH_BASE_PATH,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.BASE_URL.origin],
  socialProviders: {
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    },
  },
  plugins: [
    deviceAuthorization({ verificationUri: DEVICE_VERIFICATION_PATH }),
    bearer(),
    // Required by `oauthProvider`, which refuses to resolve a request without it: the keys it
    // signs with live in `jwks`, and it reads them through this plugin rather than holding any of
    // its own. Not here for identity tokens — see the note on scopes above.
    jwt({ jwt: { issuer: env.BASE_URL.origin, audience: MCP_RESOURCE } }),
    oauthProvider({
      loginPage: SIGN_IN_PATH,
      consentPage: CONSENT_PATH,
      scopes: OAUTH_SCOPES,
      // An MCP client is one nobody at nibrun has ever heard of, so there is no one to register it
      // by hand and nothing it could authenticate as beforehand. What stands in for that is the
      // consent page: a client is only ever a client, and access begins when an owner says yes.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      resources: [MCP_RESOURCE],
      // `enforcePerClientResources` defaults on, which means a client is refused a token for a
      // resource it is not linked to — and a client that registered itself is linked to nothing.
      // This is what links each one as it registers.
      clientRegistrationDefaultResources: [MCP_RESOURCE],
    }),
  ],
});
