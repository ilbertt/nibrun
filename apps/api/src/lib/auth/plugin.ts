import Elysia from 'elysia';
import type { Identity } from '#lib/auth/identity.ts';
import type { AuthenticationServiceContract } from '#services/authentication.service.ts';

export function createAuthPlugin(authenticationService: AuthenticationServiceContract) {
  return new Elysia({ name: 'auth' }).macro({
    auth: function authenticationPolicy(policy: Identity | { deploymentGrant: true }) {
      if (typeof policy === 'object') {
        return {
          async resolve({ request, params }) {
            return {
              deploymentAccess: await authenticationService.authenticateAppDeployment({
                headers: request.headers,
                appId: params && 'appId' in params ? params.appId : undefined,
              }),
            };
          },
        };
      }
      return {
        async resolve({ request }) {
          return await authenticationService.authenticateAccount({
            headers: request.headers,
            identity: policy,
          });
        },
      };
    },
  });
}
