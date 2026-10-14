import { AppIdSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { parseAccessTokenAuthorization } from 'better-auth/oauth2';
import { DeploymentGrantIdSchema, type OwnerId, OwnerIdSchema } from '#lib/api/identifiers.ts';
import type { Auth } from '#lib/auth/better-auth.ts';
import { AuthCaller } from '#lib/auth/caller.ts';
import {
  DEPLOYMENT_TOKEN_PERMISSION,
  shortLivedDeploymentTokenConfiguration,
} from '#lib/auth/deployment-api-keys.ts';
import type { AuthenticationPolicy } from '#lib/auth/policy.ts';
import { ForbiddenError, UnauthorizedError } from '#lib/errors.ts';
import type { GitHubDeploymentGrantRow } from '#repositories/github-deployment-grants.repository.ts';
import type { GitHubDeploymentGrantsServiceContract } from '#services/github-deployment-grants.service.ts';
import { Service } from '#services/service.ts';

type DeploymentGrantAuthenticationServiceContract = Pick<
  GitHubDeploymentGrantsServiceContract,
  'authenticate'
>;
type AccountSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
const DeploymentGrantReferenceSchema = Type.Object({ grantId: DeploymentGrantIdSchema });

export type AuthenticatedAccount = {
  user: Omit<AccountSession['user'], 'isAnonymous'> & { isAnonymous: boolean };
  session: AccountSession['session'];
};
export type AuthenticateRequestInput = AuthenticationPolicy & {
  request: Request;
  appId: unknown;
};
export type AuthenticatedAppDeployment = {
  ownerId: OwnerId;
  isAnonymous: boolean;
  deploymentGrant: Pick<GitHubDeploymentGrantRow, 'expires_at'> | null;
};
export type AuthenticatedRequest =
  | AuthenticatedAccount
  | { deploymentAccess: AuthenticatedAppDeployment };

export interface AuthenticationServiceContract {
  authenticateRequest(input: AuthenticateRequestInput): Promise<AuthenticatedRequest>;
}

export class AuthenticationService extends Service implements AuthenticationServiceContract {
  private readonly auth: Auth['api'];
  private readonly grantsService: DeploymentGrantAuthenticationServiceContract;

  constructor({
    auth,
    grantsService,
  }: {
    auth: Auth['api'];
    grantsService: DeploymentGrantAuthenticationServiceContract;
  }) {
    super();
    this.auth = auth;
    this.grantsService = grantsService;
  }

  async authenticateRequest({
    request,
    appId,
    policies,
  }: AuthenticateRequestInput): Promise<AuthenticatedRequest> {
    const acceptsDeployment = policies.includes(AuthCaller.GitHubOidcDeployment);
    const session = await this.auth.getSession({ headers: request.headers });
    if (session) {
      const account = this.authorizeAccount({ session, policies });
      return acceptsDeployment
        ? { deploymentAccess: this.accountDeploymentAccess(account) }
        : account;
    }
    if (!acceptsDeployment) {
      throw new UnauthorizedError('An account session is required.');
    }
    return {
      deploymentAccess: await this.authenticateDeploymentGrant({ request, appId }),
    };
  }

  private accountDeploymentAccess({ user }: AuthenticatedAccount): AuthenticatedAppDeployment {
    return {
      ownerId: Value.Parse(OwnerIdSchema, user.id),
      isAnonymous: user.isAnonymous,
      deploymentGrant: null,
    };
  }

  private authorizeAccount({
    session,
    policies,
  }: {
    session: AccountSession;
    policies: AuthenticationPolicy['policies'];
  }): AuthenticatedAccount {
    const user = { ...session.user, isAnonymous: session.user.isAnonymous === true };
    const caller = user.isAnonymous ? AuthCaller.AnonymousAccount : AuthCaller.RegisteredAccount;
    if (!policies.includes(caller)) {
      throw new ForbiddenError('This account is not allowed on this route.');
    }
    return { user, session: session.session };
  }

  private async deploymentToken({ headers, appId }: { headers: Headers; appId: string }) {
    const authorization = parseAccessTokenAuthorization(headers.get('authorization'));
    if (authorization?.scheme !== 'Bearer') {
      throw new UnauthorizedError('A deployment Bearer token is required.');
    }
    const verification = await this.auth.verifyApiKey({
      body: {
        configId: shortLivedDeploymentTokenConfiguration.configId,
        key: authorization.token,
        permissions: { [appId]: [DEPLOYMENT_TOKEN_PERMISSION] },
      },
    });
    if (!verification.valid || !verification.key?.expiresAt) {
      throw new UnauthorizedError('Invalid or expired deployment token.');
    }
    if (!Value.Check(DeploymentGrantReferenceSchema, verification.key.metadata)) {
      throw new UnauthorizedError('The deployment token has no grant.');
    }
    return {
      ownerId: verification.key.referenceId,
      grantId: verification.key.metadata.grantId,
      expiresAt: verification.key.expiresAt,
    };
  }

  private async authenticateDeploymentGrant({
    request,
    appId,
  }: Pick<AuthenticateRequestInput, 'request' | 'appId'>): Promise<AuthenticatedAppDeployment> {
    if (!Value.Check(AppIdSchema, appId)) {
      throw new UnauthorizedError('A deployment token requires an app.');
    }
    const token = await this.deploymentToken({ headers: request.headers, appId });
    const grant = await this.grantsService.authenticate({
      appId,
      ownerId: Value.Parse(OwnerIdSchema, token.ownerId),
      grantId: Value.Parse(DeploymentGrantIdSchema, token.grantId),
    });
    return {
      ownerId: grant.owner_id,
      isAnonymous: false,
      deploymentGrant: {
        expires_at: new Date(Math.min(grant.expires_at.getTime(), token.expiresAt.getTime())),
      },
    };
  }
}
