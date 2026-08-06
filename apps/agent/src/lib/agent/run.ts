import { Effect, Option } from 'effect';
import { filesystemLoop } from '#lib/agent/filesystem.ts';
import { heartbeatLoop } from '#lib/agent/heartbeat.ts';
import { logLoop } from '#lib/agent/logs.ts';
import { pollLoop, reconcileSafely } from '#lib/agent/poll.ts';
import { reportLoop } from '#lib/agent/report.ts';
import { statusLoop } from '#lib/agent/status.ts';
import { tenantLogSocketPath } from '#lib/logs/vsock.ts';
import { AgentSessionHolder } from '#services/agent-session-holder.service.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { Reconciler } from '#services/reconciler.service.ts';
import { TenantLogReceiver } from '#services/tenant-log-receiver.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';

const restoreLogReceivers = Effect.gen(function* () {
  const vms = yield* VmManager;
  const receiver = yield* TenantLogReceiver;
  yield* Effect.forEach(
    yield* AgentState.records,
    (record) =>
      receiver
        .attach({
          source: {
            appId: record.appId,
            deploymentId: record.deploymentId,
          },
          socketPath: tenantLogSocketPath({ workingDir: vms.workingDir(record.appId) }),
        })
        .pipe(
          Effect.catchAll((error) =>
            Effect.logWarning('tenant log receiver restore failed', error).pipe(
              Effect.annotateLogs({ appId: record.appId }),
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
  yield* Effect.all([pollLoop, statusLoop, reportLoop, logLoop, heartbeatLoop, filesystemLoop], {
    concurrency: 'unbounded',
  });
});
