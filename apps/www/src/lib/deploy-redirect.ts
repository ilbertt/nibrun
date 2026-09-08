import { findPreset } from '@repo/deploy-link';
import { DASHBOARD_DEPLOY_PATH, WWW_DEPLOY_PATH } from '@repo/global-constants';
import { DASHBOARD_ORIGIN } from '#lib/dashboard-origin.ts';
import { deployHref } from '#lib/deploy-href.ts';

const DEPLOY_ROUTE = new RegExp(`^${WWW_DEPLOY_PATH}(?:/([a-z0-9-]+))?/?$`);

// Temporary rather than permanent: a preset is edited in place, and a browser holding a permanent
// move would keep following the version of it that it first saw.
const MOVED_FOR_NOW = 302;

/**
 * The worker answers the deploy screen's addresses with the move itself. A prerendered file could
 * only have carried a redirect a browser performs after rendering it, which is a page nobody asked
 * to see on the way to one they did.
 */
export function deployRedirect(request: Request): Response | undefined {
  const match = DEPLOY_ROUTE.exec(new URL(request.url).pathname);

  if (match === null) {
    return undefined;
  }

  const slug = match[1];

  if (slug === undefined) {
    return Response.redirect(`${DASHBOARD_ORIGIN}${DASHBOARD_DEPLOY_PATH}`, MOVED_FOR_NOW);
  }

  const preset = findPreset(slug);

  return preset === undefined ? undefined : Response.redirect(deployHref(preset), MOVED_FOR_NOW);
}
