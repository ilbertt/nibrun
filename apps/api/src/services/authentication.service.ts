import type { Auth } from '#lib/auth/better-auth.ts';
import { Identity } from '#lib/auth/identity.ts';
import { ForbiddenError, UnauthorizedError } from '#lib/errors.ts';
import { Service } from '#services/service.ts';

type AccountSessionServiceContract = Pick<Auth['api'], 'getSession'>;
type AccountSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

export type AuthenticateAccountInput = {
  headers: Headers;
  identity: Identity;
};

export type AuthenticatedAccount = {
  user: Omit<AccountSession['user'], 'isAnonymous'> & { isAnonymous: boolean };
  session: AccountSession['session'];
};

export interface AuthenticationServiceContract {
  authenticateAccount(input: AuthenticateAccountInput): Promise<AuthenticatedAccount>;
}

export class AuthenticationService extends Service implements AuthenticationServiceContract {
  private readonly accountSessions: AccountSessionServiceContract;

  constructor(accountSessions: AccountSessionServiceContract) {
    super();
    this.accountSessions = accountSessions;
  }

  async authenticateAccount({
    headers,
    identity,
  }: AuthenticateAccountInput): Promise<AuthenticatedAccount> {
    const session = await this.accountSessions.getSession({ headers });
    if (!session) {
      throw new UnauthorizedError();
    }
    const user = { ...session.user, isAnonymous: session.user.isAnonymous === true };
    if (identity === Identity.Required && user.isAnonymous) {
      throw new ForbiddenError('Sign in to do this.');
    }
    return { user, session: session.session };
  }
}
