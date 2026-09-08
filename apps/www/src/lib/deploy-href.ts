import type { DeployLink } from '@repo/deploy-link';
import { DASHBOARD_DEPLOY_PATH } from '@repo/global-constants';
import { defaultStringifySearch } from '@tanstack/react-router';
import { DASHBOARD_ORIGIN } from '#lib/dashboard-origin.ts';

/**
 * The deploy screen is the dashboard's, so a link written here addresses it there.
 *
 * The search is written by the router that reads it on the far side: the deploy screen takes it
 * back apart with `JSON.parse`, so a value spelled out here would be a value it read as something
 * other than what the link holds.
 */
export function deployHref(link: DeployLink): string {
  return `${DASHBOARD_ORIGIN}${DASHBOARD_DEPLOY_PATH}${defaultStringifySearch(link)}`;
}
