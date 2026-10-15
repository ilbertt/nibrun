import { apiKey } from '@better-auth/api-key';
import { cimd } from '@better-auth/cimd';
import { mcp } from '@better-auth/mcp';
import { Value } from '@sinclair/typebox/value';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { getOAuthState } from 'better-auth/api';
import { anonymous, bearer, deviceAuthorization, jwt } from 'better-auth/plugins';
import { type OwnerId, OwnerIdSchema } from '#lib/api/identifiers.ts';
import {
  protectShortLivedDeploymentTokens,
  shortLivedDeploymentTokenConfiguration,
} from '#lib/auth/deployment-api-keys.ts';
import { OAUTH_ISSUER } from '#lib/auth/oauth-issuer.ts';
import { AUTH_BASE_PATH, AUTH_JWKS_PATH } from '#lib/auth/paths.ts';
import { env } from '#lib/env.ts';
import { MCP_RESOURCE, MCP_SCOPE } from '#lib/mcp/auth.ts';
import { fetchClientMetadataResource } from '#lib/mcp/cimd-transport.ts';
import { isMcpAuthorizationQuery } from '#lib/mcp/signup.ts';
import type { AnalyticsServiceContract } from '#services/analytics.service.ts';
import type { AppsService } from '#services/apps.service.ts';

const DEVICE_VERIFICATION_PATH = '/device';

/**
 * A stranger who signed in with an identity, and the person they now are. Whatever the stranger
 * held is the person's to keep, and moving it is the caller's — better-auth deletes the stranger
 * the moment the hook returns.
 */
export type AccountLink = { from: OwnerId; to: OwnerId };

/** What signing in needs of the apps service, and nothing else it can do. */
export type AppClaimServiceContract = Pick<AppsService, 'claim'>;

/**
 * A factory rather than an instance, so that what better-auth is given to call back into is
 * handed to it where the rest of the graph is wired — `src/services/plugins.ts` — rather than
 * reached for from here. The one instance the api serves is made there; the schema the CLI
 * prints is read off another, in `scripts/auth-schema.ts`, with nothing behind it.
 */
export function createAuth({
  appsService,
  analyticsService,
  database,
}: {
  appsService: AppClaimServiceContract;
  analyticsService: AnalyticsServiceContract;
  database: NonNullable<BetterAuthOptions['database']>;
}) {
  return betterAuth({
    database,
    baseURL: env.BASE_URL.origin,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    disabledPaths: ['/token'],
    hooks: { before: protectShortLivedDeploymentTokens },
    databaseHooks: {
      user: {
        create: {
          async after(...[user, context]) {
            if (
              user.isAnonymous ||
              !context?.path?.startsWith('/callback/') ||
              context.headers?.get('dnt') === '1'
            ) {
              return;
            }
            const state = await getOAuthState();
            if (isMcpAuthorizationQuery(state?.serverContext?.query)) {
              void analyticsService.track({
                ownerId: Value.Parse(OwnerIdSchema, user.id),
                event: { name: 'mcp_signup_completed', data: {} },
              });
            }
          },
        },
      },
    },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
    },
    plugins: [
      apiKey([shortLivedDeploymentTokenConfiguration]),
      jwt({
        jwt: { issuer: OAUTH_ISSUER },
        jwks: { jwksPath: AUTH_JWKS_PATH },
        disableSettingJwtHeader: true,
      }),
      mcp({
        loginPage: '/login',
        consentPage: '/consent',
        resource: MCP_RESOURCE.href,
        scopes: [MCP_SCOPE, 'offline_access'],
        grantTypes: ['authorization_code', 'refresh_token'],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientPrivileges() {
          return false;
        },
        resourcePrivileges() {
          return false;
        },
      }),
      cimd({
        metadataProfile: 'mcp-2026-07-28',
        fetchClientMetadataResource,
      }),
      deviceAuthorization({ verificationUri: DEVICE_VERIFICATION_PATH }),
      bearer(),
      anonymous({
        async onLinkAccount({ anonymousUser, newUser }) {
          await appsService.claim({
            from: Value.Parse(OwnerIdSchema, anonymousUser.user.id),
            to: Value.Parse(OwnerIdSchema, newUser.user.id),
          });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
