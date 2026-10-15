import type { AuthInfo } from '@modelcontextprotocol/server';
import { Value } from '@sinclair/typebox/value';
import { parseAccessTokenAuthorization } from 'better-auth/oauth2';
import type { JWTPayload } from 'jose';
import { ForbiddenError } from '#lib/errors.ts';
import { MCP_RESOURCE, McpAccessTokenClaimsSchema } from '#lib/mcp/auth.ts';
import { Service } from '#services/service.ts';

export class McpAuthorizationService extends Service {
  authorize({ request, claims }: { request: Request; claims: JWTPayload }): AuthInfo {
    if (!Value.Check(McpAccessTokenClaimsSchema, claims)) {
      throw new ForbiddenError('The access token has no valid nibrun account identity.');
    }
    return {
      token: parseAccessTokenAuthorization(request.headers.get('authorization'))!.token,
      clientId: claims.client_id,
      scopes: claims.scope.split(' '),
      expiresAt: claims.exp,
      resource: MCP_RESOURCE,
      extra: { ownerId: claims.sub },
    };
  }
}
