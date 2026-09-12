import { createAuth } from '#lib/auth/better-auth.ts';

/**
 * What `auth generate --config scripts/auth-schema.ts` reads: an instance made only to be asked
 * what tables it expects. The schema is decided by the plugins `createAuth` lists, so this cannot
 * say anything the served instance does not.
 */
export const auth = createAuth();
