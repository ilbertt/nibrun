import type { RuntimeValueName } from '@repo/api-client/models';

export const GUEST_ENVIRONMENT = {
  HTTP_PORT: 'NIBRUN_HTTP_PORT',
  HOSTNAME: 'NIBRUN_HOSTNAME',
} as const satisfies Record<string, RuntimeValueName>;
