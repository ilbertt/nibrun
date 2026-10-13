import type { Auth } from '#lib/auth/better-auth.ts';
import { AuthCaller } from '#lib/auth/caller.ts';
import type { AuthenticationPolicy } from '#lib/auth/policy.ts';
import { ForbiddenError, UnauthorizedError } from '#lib/errors.ts';
import { Service } from '#services/service.ts';

type AccountSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

export type AuthenticateAccountInput = AuthenticationPolicy & { headers: Headers };

export type AuthenticatedAccount = {
  user: Omit<AccountSession['user'], 'isAnonymous'> & { isAnonymous: boolean };
  session: AccountSession['session'];
};

export interface AuthenticationServiceContract {
  authenticateAccount(input: AuthenticateAccountInput): Promise<AuthenticatedAccount>;
}

export class AuthenticationService extends Service implements AuthenticationServiceContract {
  private readonly auth: Auth['api'];

  constructor(auth: Auth['api']) {
    super();
    this.auth = auth;
  }

  async authenticateAccount({
    headers,
    policies,
  }: AuthenticateAccountInput): Promise<AuthenticatedAccount> {
    const session = await this.auth.getSession({ headers });
    if (!session) {
      throw new UnauthorizedError('An account session is required.');
    }
    const user = { ...session.user, isAnonymous: session.user.isAnonymous === true };
    const caller = user.isAnonymous ? AuthCaller.AnonymousAccount : AuthCaller.RegisteredAccount;
    if (!policies.includes(caller)) {
      throw new ForbiddenError('This account is not allowed on this route.');
    }
    return { user, session: session.session };
  }
}
