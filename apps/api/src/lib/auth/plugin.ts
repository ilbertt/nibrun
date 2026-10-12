import Elysia from 'elysia';
import type { Identity } from '#lib/auth/identity.ts';
import type { AuthenticationServiceContract } from '#services/authentication.service.ts';

export function createAuthPlugin(authenticationService: AuthenticationServiceContract) {
  return new Elysia({ name: 'auth' }).macro({
    auth: function accountPolicy(identity: Identity) {
      return {
        async resolve({ request }) {
          return await authenticationService.authenticateAccount({
            headers: request.headers,
            identity,
          });
        },
      };
    },
  });
}
