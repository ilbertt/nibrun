import type { HttpClient } from '@effect/platform';
import type { AppId } from '@repo/protocol';
import { Data, Deferred, Duration, Effect, Option, Ref, Schedule } from 'effect';
import { reportedMessage } from '#lib/failure.ts';
import { probeInstance } from '#lib/health/probe.ts';
import { startInstance } from '#lib/reconcile/instances.ts';
import type { InstanceRecord } from '#lib/report/instance-record.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { ArtifactStore } from '#services/artifact-store.service.ts';
import { CommandRunner } from '#services/command-runner.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';

/**
 * Tighter than the startup grid the status loop probes on, because somebody is holding a browser
 * tab open on this one. The difference between finding out at 25ms and at 250ms is a quarter of
 * a second added to every cold start.
 */
const PROBE_INTERVAL_MS = 25;
const PROBE_INTERVAL = Duration.millis(PROBE_INTERVAL_MS);

/**
 * Everything starting a microVM touches, taken from where this service is built rather than left
 * to whoever calls `wake`. The caller is a request handler bridged onto a Bun socket: it holds a
 * runtime, and a runtime has to name what is in it — so a requirement that escaped here would be
 * the whole agent, named again at that boundary and built a second time behind it.
 */
type WakeContext = Effect.Effect.Context<ReturnType<typeof startInstance>> | HttpClient.HttpClient;

export class WakeFailed extends Data.TaggedError('WakeFailed')<{
  readonly appId: AppId;
  readonly reason: string;
}> {
  override get message() {
    return `${this.appId} could not be woken: ${this.reason}`;
  }
}

/**
 * Brings an `on-request` app's microVM up because something asked for it, and does not come back
 * until the guest is answering — the request that caused this is waiting on it.
 *
 * One wake per app at a time. A cold page load is a burst of requests, and every one of them
 * arrives to find no microVM: without this the first would boot it and the rest would each spend
 * the app's restart budget racing that boot.
 */
export class AppWaker extends Effect.Service<AppWaker>()('AppWaker', {
  effect: Effect.gen(function* () {
    const cache = yield* DesiredStateCache;
    const context = yield* Effect.context<WakeContext>();
    const inFlight = yield* Ref.make(new Map<AppId, Deferred.Deferred<void, WakeFailed>>());

    /**
     * The grace period is the deadline: past it the health loop would call the instance failed
     * anyway, so holding the request longer only delays telling whoever sent it.
     */
    const untilAnswering = (record: InstanceRecord) =>
      probeInstance({
        guestIpv4: record.guestIpv4,
        httpPort: record.httpPort,
        healthCheck: record.healthCheck,
      }).pipe(
        Effect.repeat({
          schedule: Schedule.spaced(PROBE_INTERVAL),
          until: (answering) => answering,
        }),
        Effect.timeoutFail({
          duration: Duration.millis(record.healthCheck.gracePeriodMs),
          onTimeout: () =>
            new WakeFailed({
              appId: record.appId,
              reason: `nothing answered on port ${record.httpPort} inside the guest`,
            }),
        }),
        Effect.asVoid,
      );

    const boot = Effect.fn('AppWaker.boot')(function* (appId: AppId) {
      const desired = yield* cache.latest;
      const wanted = Option.getOrUndefined(desired)?.instances.find(
        (instance) => instance.appId === appId,
      );
      if (!wanted) {
        return yield* new WakeFailed({ appId, reason: 'the control plane no longer names it' });
      }
      if (wanted.desiredState !== 'on-request') {
        return yield* new WakeFailed({ appId, reason: `it is ${wanted.desiredState}` });
      }
      // The same bar a reconcile start has to clear: a tenant boots onto a host whose isolation
      // ruleset is in the kernel, and a request is not a reason to make an exception.
      if (!(yield* AgentState.snapshot).isolated) {
        return yield* new WakeFailed({ appId, reason: 'the isolation ruleset is not applied' });
      }

      // A slot table with nothing free is the one start failure a request can cause, and it is
      // this host's problem rather than this app's — so it is said in the same breath as any
      // other reason the microVM is not there.
      yield* startInstance(wanted).pipe(
        Effect.catchAll((error) => new WakeFailed({ appId, reason: reportedMessage(error) })),
      );

      const record = (yield* AgentState.snapshot).records.get(appId);
      if (!record?.startedAt) {
        // A start that wrote no time never reached the VMM: the artifact would not fetch, or the
        // restart budget was spent on boots that already failed.
        return yield* new WakeFailed({
          appId,
          reason: record?.message ?? 'the microVM would not start',
        });
      }
      yield* untilAnswering(record);
      yield* Effect.logInfo('app woken by a request').pipe(Effect.annotateLogs({ appId }));
    });

    return {
      wake: Effect.fn('AppWaker.wake')(function* (appId: AppId) {
        const claim = yield* Deferred.make<void, WakeFailed>();
        const held = yield* Ref.modify(inFlight, (current) => {
          const existing = current.get(appId);
          return existing
            ? ([Option.some(existing), current] as const)
            : ([
                Option.none<Deferred.Deferred<void, WakeFailed>>(),
                new Map(current).set(appId, claim),
              ] as const);
        });
        if (Option.isSome(held)) {
          return yield* Deferred.await(held.value);
        }
        return yield* boot(appId).pipe(
          Effect.provide(context),
          Effect.onExit((exit) =>
            Deferred.done(claim, exit).pipe(
              Effect.andThen(
                Ref.update(inFlight, (current) => {
                  const remaining = new Map(current);
                  remaining.delete(appId);
                  return remaining;
                }),
              ),
            ),
          ),
        );
      }),
    };
  }),
  dependencies: [
    AgentConfig.Default,
    AgentState.Default,
    ArtifactStore.Default,
    CommandRunner.Default,
    DesiredStateCache.Default,
    SlotAllocator.Default,
    VmManager.Default,
  ],
}) {}
