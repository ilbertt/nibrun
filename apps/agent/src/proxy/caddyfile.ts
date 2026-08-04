import { HostnameSchema, isValidMessage } from '@repo/protocol';
import type { RouteTarget } from '#report/routes.ts';

const LOOPBACK = '127.0.0.1';
const GENERATED_HEADER = '# Rendered by the nibrun agent. Edits are lost on the next reconcile.';

/**
 * Rendered whole and replaced in one write, so rendering twice from the same routes is
 * byte-identical — which is what lets the caller reload the proxy only when something moved.
 */
export function renderAppSites(routes: readonly RouteTarget[]): string {
  const blocks = routes
    .map(siteBlock)
    .filter((block) => block !== undefined)
    .sort();
  return [GENERATED_HEADER, '', ...blocks].join('\n');
}

function siteBlock(route: RouteTarget): string | undefined {
  const addresses = route.hostnames
    .map((entry) => entry.hostname)
    // One unusable hostname would stop the whole file loading and take every app with it.
    .filter((hostname) => isValidMessage({ schema: HostnameSchema, value: hostname }))
    .sort()
    .map((hostname) => `https://${hostname}`);
  if (addresses.length === 0) {
    return undefined;
  }
  return [
    `${addresses.join(', ')} {`,
    '\timport origin_tls',
    `\treverse_proxy ${LOOPBACK}:${route.hostPort}`,
    '}',
    '',
  ].join('\n');
}
