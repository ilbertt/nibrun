import { Duration, Effect } from 'effect';
import { CONTROL_PLANE_BACKOFF } from '#lib/agent/backoff.ts';
import { supervised } from '#lib/agent/loop.ts';
import { nowTimestamp } from '#lib/clock.ts';
import * as State from '#lib/reconcile/state.ts';
import { buildReportedState } from '#lib/report/build-report.ts';
import {
  allocatableCapacity,
  readAvailableCacheBytes,
  readHostCapacity,
} from '#lib/report/capacity.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { AgentSessionHolder } from '#services/agent-session-holder.service.ts';
import { ControlPlane } from '#services/control-plane.service.ts';

const report = Effect.gen(function* () {
  const config = yield* AgentConfig;
  const control = yield* ControlPlane;
  const sessions = yield* AgentSessionHolder;

  const session = yield* sessions.current;
  const current = yield* State.snapshot;
  const records = [...current.records.values()];
  const capacity = yield* readHostCapacity(config.stateDir);

  yield* control.sendReportedState({
    sessionToken: session.sessionToken,
    report: buildReportedState({
      hostId: session.hostId,
      observedGeneration: current.observedGeneration,
      reportedAt: yield* nowTimestamp,
      state: current.converged ? 'ready' : 'registering',
      capacity,
      allocatable: allocatableCapacity({
        capacity,
        committed: records
          .filter((record) => record.state !== 'stopped' && record.state !== 'failed')
          .map((record) => record.resources),
        availableCacheBytes: yield* readAvailableCacheBytes(config.stateDir),
      }),
      versions: sessions.versions,
      records,
      volumes: current.volumeReports,
      checkpoints: current.checkpointReports,
      exports: [...current.exportReports.values()],
    }),
  });
});

export const reportLoop = Effect.gen(function* () {
  const sessions = yield* AgentSessionHolder;
  yield* supervised({
    once: Effect.andThen(
      report,
      Effect.flatMap(sessions.pollSettings, (poll) =>
        Effect.sleep(Duration.millis(poll.reportIntervalMs)),
      ),
    ).pipe(Effect.tapErrorTag('ControlPlaneError', sessions.onExpired)),
    onFailure: (cause) => Effect.logWarning('report failed', cause),
    schedule: CONTROL_PLANE_BACKOFF,
  });
});
