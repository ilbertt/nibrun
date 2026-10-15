import type { AuthInfo } from '@modelcontextprotocol/server';
import { Value } from '@sinclair/typebox/value';
import { parseAccessTokenAuthorization } from 'better-auth/oauth2';
import type { JWTPayload } from 'jose';
import { ForbiddenError } from '#lib/errors.ts';
import { MCP_RESOURCE, McpAccessTokenClaimsSchema } from '#lib/mcp/auth.ts';
import type { McpAuthorizationRepositoryContract } from '#repositories/mcp-authorization.repository.ts';
import { Service } from '#services/service.ts';

export class McpAuthorizationService extends Service {
  private readonly mcpAuthorizationRepo: McpAuthorizationRepositoryContract;

  constructor(mcpAuthorizationRepo: McpAuthorizationRepositoryContract) {
    super();
    this.mcpAuthorizationRepo = mcpAuthorizationRepo;
  }

  async authorize({
    request,
    claims,
  }: {
    request: Request;
    claims: JWTPayload;
  }): Promise<AuthInfo> {
    if (!Value.Check(McpAccessTokenClaimsSchema, claims)) {
      throw new ForbiddenError('The access token has no valid nibrun account identity.');
    }
    if (!(await this.mcpAuthorizationRepo.isRegisteredAccount(claims.sub))) {
      throw new ForbiddenError('A registered nibrun account is required.');
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
