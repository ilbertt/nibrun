import type { HttpClient } from '@effect/platform';
import type { AppId } from '@repo/protocol';
import { Clock, Data, Deferred, Duration, Effect, Option, Ref, Schedule } from 'effect';
import { reportedMessage } from '#lib/failure.ts';
import { probeInstance } from '#lib/health/probe.ts';
import { resumeInstance } from '#lib/reconcile/instances.ts';
import type { InstanceRecord } from '#lib/report/instance-record.ts';
import type { HostHasNoRoom } from '#lib/report/memory.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { CommandRunner } from '#services/command-runner.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { HostMemory } from '#services/host-memory.service.ts';
import { RefreshSignal } from '#services/refresh-signal.service.ts';
import { ReportSignal } from '#services/report-signal.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';

/**
 * Tighter than the startup grid the status loop probes on, because somebody is holding a browser
 * tab open on this one — and tighter than it needs to be to find out, because on average half an
 * interval is added to every wake purely by asking on a grid. A restore reaches its first accept
 * in ~90ms, so 25ms spent a measured ~12ms of that on nothing; the probe is one loopback connect
 * to a guest that either has the port open or does not, which is cheap enough to ask for often.
 */
const PROBE_INTERVAL_MS = 5;
const PROBE_INTERVAL = Duration.millis(PROBE_INTERVAL_MS);

/**
 * Everything waking a microVM touches, taken from where this service is built rather than left
 * to whoever calls `wake`. The caller is a request handler bridged onto a Bun socket: it holds a
 * runtime, and a runtime has to name what is in it — so a requirement that escaped here would be
 * the whole agent, named again at that boundary and built a second time behind it.
 */
type WakeContext = Effect.Effect.Context<ReturnType<typeof resumeInstance>> | HttpClient.HttpClient;

type Claim = {
  readonly deferred: Deferred.Deferred<void, WakeFailed | HostHasNoRoom>;
  readonly joined: Ref.Ref<number>;
};

export class WakeFailed extends Data.TaggedError('WakeFailed')<{
  readonly appId: AppId;
  readonly reason: string;
}> {
  override get message() {
    return `${this.appId} could not be woken: ${this.reason}`;
  }
}

/**
 * Brings an `on-request` app's microVM back because something asked for it, and does not come
 * back until the guest is answering — the request that caused this is waiting on it.
 *
 * A restore where there is a snapshot to restore and a boot where there is not, which is the
 * difference between tens of milliseconds and a second or so. Which one happened is
 * `resumeInstance`'s to decide; what is decided here is whether it may happen at all.
 *
 * One wake per app at a time. A cold page load is a burst of requests, and every one of them
 * arrives to find no microVM: without this the first would bring it up and the rest would each
 * spend the app's restart budget racing it.
 */
export class AppWaker extends Effect.Service<AppWaker>()('AppWaker', {
  effect: Effect.gen(function* () {
    const cache = yield* DesiredStateCache;
    const refresh = yield* RefreshSignal;
    const context = yield* Effect.context<WakeContext>();
    /**
     * The joiners are counted beside the deferred rather than derived afterwards: a cold page
     * load is one wake and a burst of requests, and without the count every reading of how often
     * apps wake is really a reading of how many requests arrived while one was waking.
     */
    const inFlight = yield* Ref.make(new Map<AppId, Claim>());

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

    const boot = Effect.fn('AppWaker.boot')(function* ({
      appId,
      joined,
    }: {
      appId: AppId;
      joined: Ref.Ref<number>;
    }) {
      const startedMs = yield* Clock.currentTimeMillis;
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

      const outcome = yield* resumeInstance(wanted).pipe(
        Effect.catchAll((error) =>
          Effect.fail(
            error._tag === 'HostHasNoRoom'
              ? error
              : new WakeFailed({ appId, reason: reportedMessage(error) }),
          ),
        ),
      );

      const record = (yield* AgentState.snapshot).records.get(appId);
      if (!record?.startedAt) {
        // Neither half wrote a time, so neither reached the VMM: the artifact would not fetch,
        // the restore was refused, or the restart budget was spent on boots that already failed.
        return yield* new WakeFailed({
          appId,
          reason: record?.message ?? 'the microVM would not start',
        });
      }
      yield* untilAnswering(record);
      // The guest is answering, which is the one thing the forward rule waits on — so the loop is
      // told now rather than on its next tick. Until it refreshes, the record still says this app
      // is coming up and every request behind this one is answered by the activator.
      yield* refresh.raise;
      // `waitedMs` is the whole of what the visitor paid, `outcome` is what they paid it for:
      // a restore and a cold boot are the same line otherwise, and the difference between them
      // is the feature. `coalesced` is how many more requests waited on this same wake, so a
      // count of these lines is a count of wakes rather than of requests.
      yield* Effect.logInfo('app woken by a request').pipe(
        Effect.annotateLogs({
          appId,
          outcome,
          waitedMs: (yield* Clock.currentTimeMillis) - startedMs,
          coalesced: yield* Ref.get(joined),
        }),
      );
    });

    return {
      wake: Effect.fn('AppWaker.wake')(function* (appId: AppId) {
        const claim: Claim = {
          deferred: yield* Deferred.make<void, WakeFailed | HostHasNoRoom>(),
          joined: yield* Ref.make(0),
        };
        const held = yield* Ref.modify(inFlight, (current) => {
          const existing = current.get(appId);
          return existing
            ? ([Option.some(existing), current] as const)
            : ([Option.none<Claim>(), new Map(current).set(appId, claim)] as const);
        });
        if (Option.isSome(held)) {
          yield* Ref.update(held.value.joined, (count) => count + 1);
          return yield* Deferred.await(held.value.deferred);
        }
        return yield* boot({ appId, joined: claim.joined }).pipe(
          Effect.provide(context),
          Effect.onExit((exit) =>
            Deferred.done(claim.deferred, exit).pipe(
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
    HostMemory.Default,
    AgentState.Default,
    CommandRunner.Default,
    DesiredStateCache.Default,
    RefreshSignal.Default,
    ReportSignal.Default,
    SlotAllocator.Default,
    VmManager.Default,
  ],
}) {}
