import { type AppId, AppIdSchema, isValidMessage, Value } from '@repo/protocol';
import { appCounterName } from '#lib/network/firewall.ts';

/** What the kernel has counted against one app since the table it lives in was last written. */
export type AppTraffic = {
  readonly packets: number;
  readonly bytes: number;
};

const COUNTER_PREFIX = appCounterName('' as AppId);

/**
 * `nft -j list counters` answers with one object per counter under a top-level `nftables` array,
 * mixed in with a `metainfo` entry. Everything here is defensive about shape rather than typed
 * against it: this is another process's output, and a counter that cannot be read is one app
 * whose activity is unknown rather than a reason to fail the pass that reads the rest.
 */
export function parseAppTraffic(json: string): ReadonlyMap<AppId, AppTraffic> {
  const traffic = new Map<AppId, AppTraffic>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return traffic;
  }
  const entries = (parsed as { nftables?: unknown })?.nftables;
  if (!Array.isArray(entries)) {
    return traffic;
  }
  for (const entry of entries) {
    const counter = (entry as { counter?: unknown })?.counter;
    if (typeof counter !== 'object' || counter === null) {
      continue;
    }
    const { name, packets, bytes } = counter as Record<string, unknown>;
    if (typeof name !== 'string' || typeof packets !== 'number' || typeof bytes !== 'number') {
      continue;
    }
    const appId = appIdFrom(name);
    if (appId !== undefined) {
      traffic.set(appId, { packets, bytes });
    }
  }
  return traffic;
}

/** Counters this table holds that are not an app's are somebody else's to explain, so they are skipped. */
function appIdFrom(name: string): AppId | undefined {
  if (!name.startsWith(COUNTER_PREFIX)) {
    return undefined;
  }
  const value = name.slice(COUNTER_PREFIX.length);
  return isValidMessage({ schema: AppIdSchema, value })
    ? Value.Parse(AppIdSchema, value)
    : undefined;
}
