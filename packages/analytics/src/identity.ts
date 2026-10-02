import { BASE_DOMAIN } from '@repo/global-constants';

const COOKIE_NAME = 'nibrun_analytics';
const COOKIE_LIFETIME_DAYS = 90;
const COOKIE_LIFETIME_SECONDS = 60 * 60 * 24 * COOKIE_LIFETIME_DAYS;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function analyticsIdentity(): string | undefined {
  try {
    const existing = document.cookie
      .split('; ')
      .find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`));
    const id = existing?.slice(`${COOKIE_NAME}=`.length);
    if (id && UUID.test(id)) {
      return id;
    }
    const created = crypto.randomUUID();
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store is unavailable in older browsers that can still deploy.
    document.cookie = `${COOKIE_NAME}=${created}; Domain=${BASE_DOMAIN}; Path=/; Max-Age=${COOKIE_LIFETIME_SECONDS}; Secure; SameSite=Lax`;
    return document.cookie.includes(`${COOKIE_NAME}=${created}`) ? created : undefined;
  } catch {
    return undefined;
  }
}
