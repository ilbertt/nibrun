import { Effect, Option } from 'effect';
import type { ForwardedInstance } from '#lib/network/firewall.ts';
import { renderableRoutes } from '#lib/report/routes.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { AppActivator } from '#services/app-activator.service.ts';
import { CaddyProxy } from '#services/caddy-proxy.service.ts';
import { HostFirewall } from '#services/host-firewall.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';

export const routes = Effect.map(AgentState.records, renderableRoutes);

export const applyRoutes = Effect.gen(function* () {
  const proxy = yield* CaddyProxy;
  yield* proxy
    .apply(yield* routes)
    .pipe(Effect.catchAll((error) => Effect.logError('proxy reload failed', error)));
});

/** A listener on every port this host holds a slot for, so one with no forward still answers. */
export const applyActivators = Effect.gen(function* () {
  const allocator = yield* SlotAllocator;
  const activator = yield* AppActivator;
  yield* activator.serve(yield* allocator.slots);
});

/**
 * Only a tenant that has answered is forwarded: a booted-but-dead VM must never take traffic.
 * The rule is the switch on the loopback port an app is reached by — with it the request is
 * rewritten to the guest before local delivery, and without it the agent answers it instead.
 */
export const forwardedInstances = Effect.gen(function* () {
  const allocator = yield* SlotAllocator;
  const all = yield* AgentState.records;
  const forwarded: ForwardedInstance[] = [];
  for (const record of all.filter((one) => one.state === 'running')) {
    const slot = yield* allocator.lookup(record.appId);
    if (Option.isSome(slot)) {
      forwarded.push({
        hostPort: slot.value.hostPort,
        httpPort: record.httpPort,
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
  const firewall = yield* HostFirewall;
  yield* firewall
    .apply({
      instances: yield* forwardedInstances,
      controlPlaneCidrsV4: config.controlPlaneCidrsV4,
      controlPlaneCidrsV6: config.controlPlaneCidrsV6,
    })
    .pipe(
      Effect.andThen(AgentState.modify((current) => ({ ...current, isolated: true }))),
      Effect.catchAll((error) =>
        AgentState.modify((current) => ({ ...current, isolated: false })).pipe(
          Effect.andThen(Effect.logError('firewall apply failed', error)),
        ),
      ),
    );
});
