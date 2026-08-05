import { Effect, Option } from 'effect';
import type { ForwardedInstance } from '#lib/network/firewall.ts';
import { applyRuleset } from '#lib/network/nftables.ts';
import { renderableRoutes } from '#lib/report/routes.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { CaddyProxy } from '#services/caddy-proxy.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';

export const routes = Effect.map(AgentState.records, renderableRoutes);

export const applyRoutes = Effect.gen(function* () {
  const proxy = yield* CaddyProxy;
  yield* proxy
    .apply(yield* routes)
    .pipe(Effect.catchAll((error) => Effect.logError('proxy reload failed', error)));
});

const forwards = Effect.gen(function* () {
  const allocator = yield* SlotAllocator;
  const all = yield* AgentState.records;
  const forwarded: ForwardedInstance[] = [];
  for (const record of all) {
    const slot = yield* allocator.lookup(record.appId);
    if (Option.isSome(slot)) {
      forwarded.push({
        hostPort: slot.value.hostPort,
        guestPort: record.guestPort,
        hostIpv4: slot.value.hostIpv4,
        guestIpv4: slot.value.guestIpv4,
      });
    }
  }
  return forwarded;
});

/**
 * A failed apply leaves whatever was already in the kernel, because `nft -f` replaces the table
 * in one transaction. Tearing down running tenants over a transient failure would be the bigger
 * outage — refusing to add new ones is the part that has to hold.
 */
export const applyNetwork = Effect.gen(function* () {
  const config = yield* AgentConfig;
  yield* applyRuleset({
    instances: yield* forwards,
    controlPlaneCidrsV4: config.controlPlaneCidrsV4,
    controlPlaneCidrsV6: config.controlPlaneCidrsV6,
    guestDnsServers: config.guestDnsServers,
  }).pipe(
    Effect.andThen(AgentState.modify((current) => ({ ...current, isolated: true }))),
    Effect.catchAll((error) =>
      AgentState.modify((current) => ({ ...current, isolated: false })).pipe(
        Effect.andThen(Effect.logError('firewall apply failed', error)),
      ),
    ),
  );
});
