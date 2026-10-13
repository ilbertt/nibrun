import Elysia from 'elysia';
import type { AuthenticationPolicy } from '#lib/auth/policy.ts';
import type { AuthenticationServiceContract } from '#services/authentication.service.ts';

export function createAuthPlugin(authenticationService: AuthenticationServiceContract) {
  return new Elysia({ name: 'auth' }).macro({
    auth: function authenticationPolicy(policy: AuthenticationPolicy) {
      return {
        async resolve({ request }) {
          return await authenticationService.authenticateAccount({
            headers: request.headers,
            policies: policy.policies,
          });
        },
      };
    },
  });
}
