import { HostnameSchema, isValidMessage } from '@repo/protocol';
import type { RouteTarget } from '#report/routes.ts';

const LOOPBACK = '127.0.0.1';
const GENERATED_HEADER = '# Rendered by the nibrun agent. Edits are lost on the next reconcile.';

/**
 * The site blocks for the apps this host is running, imported by the static Caddyfile the deploy
 * installs.
 *
 * Rendered whole and replaced in one write, like the nftables ruleset: there is no incremental
 * add or remove to miss, and rendering twice from the same records is byte-identical — which is
 * what lets the caller reload the proxy only when something really moved.
 *
 * The upstream is the loopback port the host forwards into the guest. A slot is per app rather
 * than per instance, so a redeploy is a new microVM behind an address that never changed.
 */
export function renderAppSites(routes: readonly RouteTarget[]): string {
  const blocks = routes
    .map(siteBlock)
    .filter((block) => block !== undefined)
    // Records arrive in whatever order the agent happens to hold them, and the caller decides
    // whether to reload by comparing this text with what it wrote last.
    .sort();
  return [GENERATED_HEADER, '', ...blocks].join('\n');
}

function siteBlock(route: RouteTarget): string | undefined {
  const addresses = route.hostnames
    .map((entry) => entry.hostname)
    // The records these come from are the agent's own cache, structurally checked rather than
    // parsed. One unusable hostname would stop the whole file loading and take routing for
    // every app on the host with it, so it is dropped instead.
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
