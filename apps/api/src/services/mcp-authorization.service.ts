import {
  type AuthInfo,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { AssertError, Value } from '@sinclair/typebox/value';
import { createLocalJWKSet, errors, jwtVerify } from 'jose';
import { OAUTH_ISSUER } from '#lib/auth/oauth-issuer.ts';
import { MCP_RESOURCE, McpAccessTokenClaimsSchema } from '#lib/mcp.ts';
import type { McpAuthorizationRepositoryContract } from '#repositories/mcp-authorization.repository.ts';
import { Service } from '#services/service.ts';

const MS_PER_SECOND = 1000;

export class McpAuthorizationService extends Service implements OAuthTokenVerifier {
  private readonly repository: McpAuthorizationRepositoryContract;

  constructor(repository: McpAuthorizationRepositoryContract) {
    super();
    this.repository = repository;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const { payload } = await jwtVerify(
        token,
        createLocalJWKSet(await this.repository.signingKeys()),
        {
          issuer: OAUTH_ISSUER,
          audience: MCP_RESOURCE.href,
          typ: 'at+jwt',
          requiredClaims: McpAccessTokenClaimsSchema.required,
        },
      );
      if (payload.cnf !== undefined) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid MCP access token.');
      }
      Value.Assert(McpAccessTokenClaimsSchema, payload);
      const claims = payload;
      if (claims.iat > Date.now() / MS_PER_SECOND) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid MCP access token.');
      }
      if (!(await this.repository.isRegisteredAccount(claims.sub))) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'A registered account is required.');
      }
      return {
        token,
        clientId: claims.client_id,
        scopes: claims.scope.split(' ').filter(Boolean),
        expiresAt: claims.exp,
        resource: MCP_RESOURCE,
        extra: { ownerId: claims.sub },
      };
    } catch (error) {
      if (error instanceof errors.JOSEError || error instanceof AssertError) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid MCP access token.');
      }
      throw error;
    }
  }
}
