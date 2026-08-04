import { Effect, Option } from 'effect';
import { logLoop } from '#agent/logs.ts';
import { pollLoop, reconcileSafely } from '#agent/poll.ts';
import { reportLoop } from '#agent/report.ts';
import { statusLoop } from '#agent/status.ts';
import { tenantLogSocketPath } from '#logs/vsock.ts';
import * as State from '#reconcile/state.ts';
import { AgentSessionHolder } from '#services/agent-session-holder.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { Reconciler } from '#services/reconciler.service.ts';
import { TenantLogReceiver } from '#services/tenant-log-receiver.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';

const restoreLogReceivers = Effect.gen(function* () {
  const vms = yield* VmManager;
  const receiver = yield* TenantLogReceiver;
  yield* Effect.forEach(
    yield* State.records,
    (record) =>
      receiver
        .attach({
          source: {
            instanceId: record.instanceId,
            appId: record.appId,
            deploymentId: record.deploymentId,
          },
          socketPath: tenantLogSocketPath({ workingDir: vms.workingDir(record.instanceId) }),
        })
        .pipe(
          Effect.catchAll((error) =>
            Effect.logWarning('tenant log receiver restore failed', error).pipe(
              Effect.annotateLogs({ instanceId: record.instanceId }),
            ),
          ),
        ),
    { discard: true },
  );
});

/**
 * Converges against the last desired state this host was given before it has even reached the
 * control plane, then joins the poll — which only ever corrects it.
 */
export const run = Effect.gen(function* () {
  const reconciler = yield* Reconciler;
  const cache = yield* DesiredStateCache;
  const sessions = yield* AgentSessionHolder;

  yield* reconciler.load;
  yield* restoreLogReceivers;

  const cached = yield* cache.restore;
  if (Option.isSome(cached)) {
    yield* reconcileSafely(cached.value);
  }

  yield* sessions.current;
  yield* Effect.all([pollLoop, statusLoop, reportLoop, logLoop], { concurrency: 'unbounded' });
});
