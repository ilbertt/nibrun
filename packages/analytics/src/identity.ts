import { BASE_DOMAIN } from '@repo/global-constants';

import {
  ANALYTICS_COOKIE_LIFETIME_SECONDS,
  ANALYTICS_UUID,
  ANALYTICS_IDENTITY_COOKIE as COOKIE_NAME,
  MCP_ATTEMPT_COOKIE,
} from '#config.ts';

export function analyticsIdentity(): string | undefined {
  try {
    const existing = document.cookie
      .split('; ')
      .find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`));
    const id = existing?.slice(`${COOKIE_NAME}=`.length);
    if (id && ANALYTICS_UUID.test(id)) {
      return id;
    }
    const created = crypto.randomUUID();
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store is unavailable in older browsers that can still deploy.
    document.cookie = `${COOKIE_NAME}=${created}; Domain=${BASE_DOMAIN}; Path=/; Max-Age=${ANALYTICS_COOKIE_LIFETIME_SECONDS}; Secure; SameSite=Lax`;
    return document.cookie.includes(`${COOKIE_NAME}=${created}`) ? created : undefined;
  } catch {
    return undefined;
  }
}

export function mcpAnalyticsAttempt(): string | undefined {
  try {
    const id = document.cookie
      .split('; ')
      .find((cookie) => cookie.startsWith(`${MCP_ATTEMPT_COOKIE}=`))
      ?.slice(MCP_ATTEMPT_COOKIE.length + 1);
    return id && ANALYTICS_UUID.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}
