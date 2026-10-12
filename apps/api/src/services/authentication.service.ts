import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { BEARER, parseAuthorizationHeader } from 'http-auth-utils';
import { type OwnerId, OwnerIdSchema } from '#lib/api/identifiers.ts';
import type { Auth } from '#lib/auth/better-auth.ts';
import { Identity } from '#lib/auth/identity.ts';
import { DEPLOYMENT_GRANT_TOKEN_PREFIX } from '#lib/deployment-grant-policy.ts';
import { ForbiddenError, UnauthorizedError } from '#lib/errors.ts';
import type { GitHubDeploymentGrantRow } from '#repositories/github-deployment-grants.repository.ts';
import type { GitHubDeploymentGrantsService } from '#services/github-deployment-grants.service.ts';
import { Service } from '#services/service.ts';

const BEARER_SCHEME_PATTERN = new RegExp(`^${BEARER.type}`, 'i');

type DeploymentGrantAuthenticationServiceContract = Pick<
  GitHubDeploymentGrantsService,
  'authenticate'
>;

type AccountSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

export type AuthenticateAccountInput = {
  headers: Headers;
  identity: Identity;
};

export type AuthenticatedAccount = {
  user: Omit<AccountSession['user'], 'isAnonymous'> & { isAnonymous: boolean };
  session: AccountSession['session'];
};

export type AuthenticateAppDeploymentInput = {
  headers: Headers;
  appId: unknown;
};

export type AuthenticatedAppDeployment = {
  ownerId: OwnerId;
  isAnonymous: boolean;
  deploymentGrant: Pick<GitHubDeploymentGrantRow, 'expires_at'> | null;
};

export interface AuthenticationServiceContract {
  authenticateAccount(input: AuthenticateAccountInput): Promise<AuthenticatedAccount>;
  authenticateAppDeployment(
    input: AuthenticateAppDeploymentInput,
  ): Promise<AuthenticatedAppDeployment>;
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

  async authenticateAccount({
    headers,
    identity,
  }: AuthenticateAccountInput): Promise<AuthenticatedAccount> {
    if (this.deploymentToken(headers) !== null) {
      throw new UnauthorizedError('An account session is required.');
    }
    const session = await this.auth.getSession({ headers });
    if (!session) {
      throw new UnauthorizedError();
    }
    const user = { ...session.user, isAnonymous: session.user.isAnonymous === true };
    if (identity === Identity.Required && user.isAnonymous) {
      throw new ForbiddenError('Sign in to do this.');
    }
    return { user, session: session.session };
  }

  async authenticateAppDeployment({
    headers,
    appId,
  }: AuthenticateAppDeploymentInput): Promise<AuthenticatedAppDeployment> {
    const token = this.deploymentToken(headers);
    if (token !== null) {
      return this.authenticateDeploymentGrant({ appId, token });
    }
    const { user } = await this.authenticateAccount({ headers, identity: Identity.Optional });
    return {
      ownerId: Value.Parse(OwnerIdSchema, user.id),
      isAnonymous: user.isAnonymous,
      deploymentGrant: null,
    };
  }

  private deploymentToken(headers: Headers): string | null {
    const authorization = headers.get('authorization');
    if (authorization === null) {
      return null;
    }
    try {
      const { type, data } = parseAuthorizationHeader(
        authorization.replace(BEARER_SCHEME_PATTERN, BEARER.type),
      );
      if (type !== BEARER.type) {
        return null;
      }
      const token = data.hash?.trim();
      if (!token) {
        throw new UnauthorizedError('A bearer token is required.');
      }
      return token.startsWith(DEPLOYMENT_GRANT_TOKEN_PREFIX) ? token : null;
    } catch {
      throw new UnauthorizedError('Invalid Authorization header.');
    }
  }

  private async authenticateDeploymentGrant({
    appId,
    token,
  }: {
    appId: AuthenticateAppDeploymentInput['appId'];
    token: string;
  }): Promise<AuthenticatedAppDeployment> {
    if (!Value.Check(AppIdSchema, appId)) {
      throw new UnauthorizedError('A deployment grant requires an app.');
    }
    const grant = await this.grantsService.authenticate({ appId, token });
    return {
      ownerId: grant.owner_id,
      isAnonymous: false,
      deploymentGrant: { expires_at: grant.expires_at },
    };
  }
}
