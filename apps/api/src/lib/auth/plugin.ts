import Elysia from 'elysia';
import type { AuthenticationPolicy } from '#lib/auth/policy.ts';
import { httpOperationClient } from '#lib/operation-client.ts';
import type { AuthenticationServiceContract } from '#services/authentication.service.ts';

export function createAuthPlugin(authenticationService: AuthenticationServiceContract) {
  return new Elysia({ name: 'auth' }).macro({
    auth: function authenticationPolicy(policy: AuthenticationPolicy) {
      return {
        async resolve({ request, params }) {
          const authenticated = await authenticationService.authenticateRequest({
            request,
            appId: params && 'appId' in params ? params.appId : undefined,
            policies: policy.policies,
          });
          return { ...authenticated, operationClient: httpOperationClient(request) };
        },
      };
    },
  });
}
