import type { AuthCaller } from '#lib/auth/caller.ts';

export type AuthenticationPolicy = {
  policies: readonly [AuthCaller, ...AuthCaller[]];
};
