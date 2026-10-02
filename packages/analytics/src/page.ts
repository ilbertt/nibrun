import { DASHBOARD_SITE, WWW_SITE } from '@repo/global-constants';

export type AnalyticsSite = 'www' | 'dashboard';

export function analyticsSite(hostname: string): AnalyticsSite | undefined {
  if (hostname === new URL(WWW_SITE.url).hostname) {
    return 'www';
  }
  return hostname === new URL(DASHBOARD_SITE.url).hostname ? 'dashboard' : undefined;
}

export function analyticsPath({
  site,
  pathname,
}: {
  site: AnalyticsSite;
  pathname: string;
}): string {
  const path = site === 'dashboard' ? pathname.replace(/^\/apps\/[^/]+/, '/apps/:appId') : pathname;
  return `/${site}${path}`;
}

export function analyticsReferrer(referrer: string): string {
  if (!referrer) {
    return '';
  }
  try {
    const url = new URL(referrer);
    const site = analyticsSite(url.hostname);
    return site ? `${url.origin}${analyticsPath({ site, pathname: url.pathname })}` : url.origin;
  } catch {
    return '';
  }
}
