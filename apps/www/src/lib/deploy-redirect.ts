import { deployHref } from '@repo/deploy-link';
import { findPreset } from '#deploy-presets.ts';
import { APP_ORIGIN } from '#lib/app-origin.ts';

const PRESET_PATH = /^\/deploy\/([a-z0-9-]+)\/?$/;

// Temporary rather than permanent: a preset is edited in place, and a browser holding a permanent
// move would keep following the version of it that it first saw.
const MOVED_FOR_NOW = 302;

/**
 * A preset is an address rather than a page, so the worker answers it with the move itself. A
 * prerendered file could only have carried a redirect a browser performs after rendering it,
 * which is a page nobody asked to see on the way to one they did.
 *
 * The address is built by `deployHref`, which writes the search the way the screen's own router
 * reads it back — the reason a preset cannot simply be spelled out as a query here.
 */
export function deployRedirect(request: Request): Response | undefined {
  const slug = PRESET_PATH.exec(new URL(request.url).pathname)?.[1];
  const preset = slug === undefined ? undefined : findPreset(slug);

  return preset === undefined
    ? undefined
    : Response.redirect(deployHref({ origin: APP_ORIGIN, link: preset }), MOVED_FOR_NOW);
}
