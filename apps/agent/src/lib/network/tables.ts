import { NFTABLES_FAMILIES, NFTABLES_TABLE } from '#lib/network/firewall.ts';

/**
 * Which of this agent's tables the kernel is holding, as one comparable value. The kernel
 * allocates a handle when a table is created, so a ruleset something else flushed and rebuilt
 * carries different ones and a ruleset that is simply gone carries none — which is what tells a
 * kernel still holding what was written from one that would merely be sent the same text again.
 */
export type KernelTables = string;

/**
 * `nft -j list tables` answers with one object per table under a top-level `nftables` array,
 * mixed in with a `metainfo` entry — the shape `parseAppTraffic` reads, and defensive about it
 * for the same reason: this is another process's output. An entry that cannot be read counts as
 * a table that is not there, so the ruleset is written again rather than assumed to be in place.
 */
export function parseKernelTables(json: string): KernelTables {
  const handles = new Map<string, number>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return '';
  }
  const entries = (parsed as { nftables?: unknown })?.nftables;
  if (!Array.isArray(entries)) {
    return '';
  }
  for (const entry of entries) {
    const table = (entry as { table?: unknown })?.table;
    if (typeof table !== 'object' || table === null) {
      continue;
    }
    const { family, name, handle } = table as Record<string, unknown>;
    if (name === NFTABLES_TABLE && typeof family === 'string' && typeof handle === 'number') {
      handles.set(family, handle);
    }
  }
  // Named in the order the ruleset writes them, so the same pair of tables never renders two ways.
  return NFTABLES_FAMILIES.flatMap((family) => {
    const handle = handles.get(family);
    return handle === undefined ? [] : [`${family}:${handle}`];
  }).join(' ');
}
