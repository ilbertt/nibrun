import { Value } from '@sinclair/typebox/value';
import { createAuthMiddleware } from 'better-auth/api';
import { decodeJwt } from 'jose';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { OAUTH_ISSUER } from '#lib/auth/oauth-issuer.ts';
import { MCP_RESOURCE, MCP_SCOPE, McpAccessTokenClaimsSchema } from '#lib/mcp/auth.ts';
import type { AnalyticsServiceContract } from '#services/analytics.service.ts';

export function createMcpConnectionAnalyticsHook(analyticsService: AnalyticsServiceContract) {
  return createAuthMiddleware(function trackMcpConnection(context) {
    if (
      context.path === '/oauth2/token' &&
      context.body?.grant_type === 'authorization_code' &&
      context.headers?.get('dnt') !== '1'
    ) {
      const ownerId = issuedMcpOwnerId(context.context.returned);
      if (ownerId) {
        void analyticsService.track({ ownerId, event: { name: 'mcp_connected', data: {} } });
      }
    }
    return Promise.resolve();
  });
}

function issuedMcpOwnerId(response: unknown): OwnerId | undefined {
  if (
    typeof response !== 'object' ||
    response === null ||
    !('access_token' in response) ||
    typeof response.access_token !== 'string'
  ) {
    return undefined;
  }
  try {
    // This token comes from Better Auth's completed response, never from the request.
    const claims = decodeJwt(response.access_token);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
      claims.iss === OAUTH_ISSUER &&
      audiences.includes(MCP_RESOURCE.href) &&
      Value.Check(McpAccessTokenClaimsSchema, claims) &&
      claims.scope.split(' ').includes(MCP_SCOPE)
    ) {
      return claims.sub;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
