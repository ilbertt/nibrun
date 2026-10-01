import type { AppId, DesiredInstance } from '@repo/protocol';
import { Effect, Exit, Fiber, Option, Scope, SynchronizedRef } from 'effect';
import { type CronDispatch, CronExecutionUnavailable, canRunCron } from '#lib/cron/dispatch.ts';
import { runLoggedGuestCron } from '#lib/cron/execution-logs.ts';
import { CronDeploymentMismatch } from '#lib/cron/registry.ts';
import { guestVsockPath } from '#lib/vm/vsock.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { AppWaker } from '#services/app-waker.service.ts';
import { CronActivity } from '#services/cron-activity.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { TenantLogQueue } from '#services/tenant-log-queue.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';

type Owner = {
  readonly deploymentId: DesiredInstance['deploymentId'];
  readonly scope: Scope.CloseableScope;
};

export class CronExecutions extends Effect.Service<CronExecutions>()('CronExecutions', {
  scoped: Effect.gen(function* () {
    const state = yield* AgentState;
    const cache = yield* DesiredStateCache;
    const activity = yield* CronActivity;
    const waker = yield* AppWaker;
    const vms = yield* VmManager;
    const logs = yield* TenantLogQueue;
    const owners = yield* SynchronizedRef.make(new Map<AppId, Owner>());

    function current(context: CronDispatch['context']) {
      return Effect.gen(function* () {
        const wanted = Option.getOrUndefined(yield* cache.latest)?.instances.find(
          (instance) => instance.appId === context.appId,
        );
        const snapshot = yield* state.snapshot;
        const record = snapshot.records.get(context.appId);
        if (
          !snapshot.isolated ||
          !canRunCron({ wanted, record, deploymentId: context.deploymentId })
        ) {
          return yield* new CronExecutionUnavailable();
        }
        return record;
      });
    }

    function dispatch(request: CronDispatch) {
      return activity.run({
        appId: request.context.appId,
        effect: Effect.gen(function* () {
          const record = yield* current(request.context);
          if (record?.state === 'idle') {
            yield* waker.wake(request.context.appId);
          }
          yield* current(request.context);
          return yield* runLoggedGuestCron({
            ...request,
            socketPath: guestVsockPath({ workingDir: vms.workingDir(request.context.appId) }),
          }).pipe(Effect.provideService(TenantLogQueue, logs));
        }),
      });
    }

    function execute(request: CronDispatch) {
      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const fiber = yield* SynchronizedRef.modifyEffect(owners, (current) =>
            Effect.gen(function* () {
              const owner = current.get(request.context.appId);
              if (owner?.deploymentId !== request.context.deploymentId) {
                return yield* new CronDeploymentMismatch();
              }
              const fiber = yield* Effect.forkIn(restore(dispatch(request)), owner.scope);
              return [fiber, current] as const;
            }),
          );
          return yield* restore(Fiber.join(fiber)).pipe(Effect.ensuring(Fiber.interrupt(fiber)));
        }),
      );
    }

    function ownerFor({
      instance,
      current,
    }: {
      instance: DesiredInstance;
      current: ReadonlyMap<AppId, Owner>;
    }) {
      return Effect.gen(function* () {
        const held = current.get(instance.appId);
        return held?.deploymentId === instance.deploymentId
          ? held
          : {
              deploymentId: instance.deploymentId,
              scope: yield* Scope.make(),
            };
      });
    }

    function syncDeployments({ instances }: { instances: readonly DesiredInstance[] }) {
      return SynchronizedRef.updateEffect(owners, (current) =>
        Effect.gen(function* () {
          const next = new Map(
            yield* Effect.forEach(
              instances.filter((instance) => instance.desiredState !== 'stopped'),
              (instance) =>
                Effect.map(
                  ownerFor({ instance, current }),
                  (owner) => [instance.appId, owner] as const,
                ),
            ),
          );
          for (const [appId, owner] of current) {
            if (next.get(appId) !== owner) {
              yield* Scope.close(owner.scope, Exit.void);
            }
          }
          return next;
        }),
      ).pipe(Effect.uninterruptible);
    }

    yield* Effect.addFinalizer(() =>
      Effect.flatMap(SynchronizedRef.get(owners), (current) =>
        Effect.forEach(current.values(), (owner) => Scope.close(owner.scope, Exit.void), {
          discard: true,
        }),
      ),
    );
    return { execute, syncDeployments };
  }),
  dependencies: [
    AgentState.Default,
    DesiredStateCache.Default,
    CronActivity.Default,
    AppWaker.Default,
    VmManager.Default,
    TenantLogQueue.Default,
  ],
}) {}
