import type { ApiKeyAppsServiceContract } from '#lib/auth/api-keys.ts';
import { type AppClaimServiceContract, createAuth } from '#lib/auth/better-auth.ts';

const appsServiceMock: AppClaimServiceContract & ApiKeyAppsServiceContract = {
  claim: () => Promise.resolve(),
  get: () => Promise.reject(new Error('Schema generation does not look up apps.')),
};

/**
 * What `auth generate --config scripts/auth-schema.ts` reads: an instance made only to be asked
 * what tables it expects. The schema is decided by the plugins `createAuth` lists, so this cannot
 * say anything the served instance does not.
 */
export const auth = createAuth({ appsService: appsServiceMock });
