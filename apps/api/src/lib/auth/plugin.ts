import Elysia from 'elysia';
import type { AuthenticationPolicy } from '#lib/auth/policy.ts';
import type { AuthenticationServiceContract } from '#services/authentication.service.ts';

export function createAuthPlugin(authenticationService: AuthenticationServiceContract) {
  return new Elysia({ name: 'auth' }).macro({
    auth: function authenticationPolicy(policy: AuthenticationPolicy) {
      return {
        async resolve({ request, params }) {
          return await authenticationService.authenticateRequest({
            request,
            appId: params && 'appId' in params ? params.appId : undefined,
            policies: policy.policies,
          });
        },
      };
    },
  });
}
