import { defaultStringifySearch } from '@tanstack/router-core';
import type { DeployLink } from '#link.ts';

const DEPLOY_PATH = '/deploy';

/**
 * The address of the deploy screen, already filled in.
 *
 * Written by the same stringifier the screen's router reads it back with, which is what decides
 * the spelling of every value: the search is taken apart with `JSON.parse`, so `?port=3000` is a
 * number there and a query written by hand is one it reads as something other than what was put
 * in it.
 */
export function deployHref({ origin, link }: { origin: string; link: DeployLink }): string {
  return `${new URL(DEPLOY_PATH, origin).href}${defaultStringifySearch(link)}`;
}
