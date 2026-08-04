import { Duration, Effect } from 'effect';
import { AgentSessionHolder } from '#agent/session.ts';
import { AgentConfig } from '#config.ts';
import { ControlPlane } from '#control/client.ts';
import { nowTimestamp } from '#lib/clock.ts';
import * as State from '#reconcile/state.ts';
import { buildReportedState } from '#report/build-report.ts';
import {
  allocatableCapacity,
  readAvailableCacheBytes,
  readHostCapacity,
} from '#report/capacity.ts';

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
  yield* report.pipe(
    Effect.tapError((error) =>
      sessions.forgetIfExpired(error).pipe(
        Effect.andThen(Effect.logWarning('report failed', error)),
      ),
    ),
    Effect.ignore,
    Effect.andThen(
      Effect.flatMap(sessions.pollSettings, (poll) =>
        Effect.sleep(Duration.millis(poll.reportIntervalMs)),
      ),
    ),
    Effect.forever,
  );
});
