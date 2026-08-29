import { defaultStringifySearch } from '@tanstack/react-router';
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
 * The search is written by the router that reads it on the far side: the deploy screen takes it
 * back apart with `JSON.parse`, so a value spelled out here would be a value it read as something
 * other than what the preset holds.
 */
export function deployRedirect(request: Request): Response | undefined {
  const slug = PRESET_PATH.exec(new URL(request.url).pathname)?.[1];
  const preset = slug === undefined ? undefined : findPreset(slug);

  return preset === undefined
    ? undefined
    : Response.redirect(`${APP_ORIGIN}/deploy${defaultStringifySearch(preset)}`, MOVED_FOR_NOW);
}
