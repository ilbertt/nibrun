import type { ApiKeyConfigurationOptions, ApiKeyOptions } from '@better-auth/api-key';

export const DEPLOYMENT_TOKEN_CONFIG_ID = 'deployment';
export const DEPLOYMENT_TOKEN_PERMISSION = 'deploy';
export const DEPLOYMENT_TOKEN_MODEL_NAME = 'deploymentToken';
export const deploymentTokenApiKeySchema = {
  apikey: { modelName: DEPLOYMENT_TOKEN_MODEL_NAME },
} satisfies ApiKeyOptions['schema'];
const SECONDS_PER_DAY = 86_400;
const REQUEST_LIMIT = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;

export function deploymentTokenApiKeyConfiguration({
  maximumLifetimeSeconds,
}: {
  maximumLifetimeSeconds: number;
}): ApiKeyConfigurationOptions {
  return {
    configId: DEPLOYMENT_TOKEN_CONFIG_ID,
    enableMetadata: true,
    enableSessionForAPIKeys: false,
    keyExpiration: {
      defaultExpiresIn: maximumLifetimeSeconds,
      minExpiresIn: 0,
      maxExpiresIn: maximumLifetimeSeconds / SECONDS_PER_DAY,
    },
    rateLimit: { enabled: true, maxRequests: REQUEST_LIMIT, timeWindow: RATE_LIMIT_WINDOW_MS },
  };
}
