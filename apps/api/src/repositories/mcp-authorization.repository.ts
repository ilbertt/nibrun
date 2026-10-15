import type { OwnerId } from '#lib/api/identifiers.ts';
import type { Auth } from '#lib/auth/better-auth.ts';

export abstract class McpAuthorizationRepositoryContract {
  abstract isRegisteredAccount(ownerId: OwnerId): Promise<boolean>;
}

export class McpAuthorizationRepository implements McpAuthorizationRepositoryContract {
  private readonly auth: Auth;

  constructor(auth: Auth) {
    this.auth = auth;
  }

  async isRegisteredAccount(ownerId: OwnerId): Promise<boolean> {
    const context = await this.auth.$context;
    const user = await context.internalAdapter.findUserById(ownerId);
    return user !== null && (!('isAnonymous' in user) || user.isAnonymous !== true);
  }
}
