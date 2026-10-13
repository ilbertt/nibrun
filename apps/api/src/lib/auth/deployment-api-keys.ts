import type { ApiKeyConfigurationOptions } from '@better-auth/api-key';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { DEPLOYMENT_TOKEN_LIFETIME_SECONDS } from '#lib/deployment-grant-policy.ts';

const SECONDS_PER_DAY = 86_400;
const REQUEST_LIMIT = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;
export const DEPLOYMENT_TOKEN_PERMISSION = 'deploy';

export const shortLivedDeploymentTokenConfiguration = {
  configId: 'deployment',
  enableMetadata: true,
  enableSessionForAPIKeys: false,
  keyExpiration: {
    defaultExpiresIn: DEPLOYMENT_TOKEN_LIFETIME_SECONDS,
    minExpiresIn: 0,
    maxExpiresIn: DEPLOYMENT_TOKEN_LIFETIME_SECONDS / SECONDS_PER_DAY,
  },
  rateLimit: { enabled: true, maxRequests: REQUEST_LIMIT, timeWindow: RATE_LIMIT_WINDOW_MS },
} satisfies ApiKeyConfigurationOptions;

export const protectShortLivedDeploymentTokens = createAuthMiddleware(
  function protectShortLivedDeploymentTokens(context) {
    if (
      (context.path === '/api-key/create' || context.path === '/api-key/update') &&
      context.body?.configId === shortLivedDeploymentTokenConfiguration.configId &&
      (context.request || context.headers)
    ) {
      throw new APIError('FORBIDDEN', {
        message: 'Deployment credentials can only be issued and updated by the server.',
      });
    }
    return Promise.resolve();
  },
);
