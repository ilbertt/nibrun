import { BASE_DOMAIN } from '@repo/global-constants';
import { trackingAllowed } from '#tracker.ts';

const COOKIE_NAME = 'nibrun_analytics_entry';
const ENTRY_LIFETIME_MINUTES = 30;
const ENTRY_SOURCES = ['preset', 'binary-drop', 'deploy-cta', 'dashboard-link', 'direct'] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];
export type AnalyticsEntry = { entry_source: EntrySource; preset_slug: string | undefined };

export function recordEntry(entry: AnalyticsEntry): void {
  if (!trackingAllowed()) {
    return;
  }
  try {
    // biome-ignore lint/suspicious/noDocumentCookie: the cross-subdomain handoff must also work in browsers without Cookie Store.
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(entry))}; Domain=${BASE_DOMAIN}; Path=/; Max-Age=${ENTRY_LIFETIME_MINUTES * 60}; Secure; SameSite=Lax`;
  } catch {
    return;
  }
}

export function readEntry(): AnalyticsEntry {
  const direct: AnalyticsEntry = { entry_source: 'direct', preset_slug: undefined };
  try {
    const cookie = document.cookie.split('; ').find((part) => part.startsWith(`${COOKIE_NAME}=`));
    if (!cookie) {
      return direct;
    }
    const entry = JSON.parse(decodeURIComponent(cookie.slice(`${COOKIE_NAME}=`.length)));
    if (!ENTRY_SOURCES.includes(entry.entry_source)) {
      return direct;
    }
    return {
      entry_source: entry.entry_source,
      preset_slug:
        typeof entry.preset_slug === 'string' && /^[a-z0-9-]+$/.test(entry.preset_slug)
          ? entry.preset_slug
          : undefined,
    };
  } catch {
    return direct;
  }
}
