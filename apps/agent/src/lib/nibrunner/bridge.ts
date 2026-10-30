import type { HostDesiredState } from '@repo/protocol';
import { Clock, Effect, Fiber, Option, Ref } from 'effect';
import { CONTROL_PLANE_BACKOFF } from '#lib/agent/backoff.ts';
import { supervised } from '#lib/agent/loop.ts';
import type { ControlPlaneClient } from '#lib/control/client.ts';
import { makeSessionHolder } from '#lib/control/session.ts';
import { nibrunnerReportedState } from '#lib/nibrunner/reported-state.ts';
import { stageNibrunnerArtifacts } from '#lib/nibrunner/stage-artifacts.ts';
import {
  ForeignNibrunnerDocument,
  nibrunnerDocument,
  readNibrunnerDesired,
  readNibrunnerDesiredDigest,
  readNibrunnerReport,
  writeNibrunnerDocument,
} from '#lib/nibrunner/state-files.ts';
import { nibrunnerWithdrawals } from '#lib/nibrunner/withdrawals.ts';
import { decode } from '#lib/protocol.ts';
import { ArtifactStore } from '#services/artifact-store.service.ts';
import type { NibrunnerBridgeConfig } from '#services/nibrunner-bridge-config.service.ts';

const REPORT_MAX_AGE_MS = 30_000;

export const makeNibrunnerBridge = Effect.fn('makeNibrunnerBridge')(function* ({
  control,
  config,
}: {
  control: ControlPlaneClient;
  config: NibrunnerBridgeConfig;
}) {
  const store = yield* ArtifactStore;
  const initial = yield* readNibrunnerReport(config.reportedStateFile);
  const sessions = yield* makeSessionHolder({
    control,
    hostIdFile: config.hostIdFile,
    versions: initial.report.versions,
    capacity: readNibrunnerReport(config.reportedStateFile).pipe(
      Effect.map(({ report }) => report.capacity),
    ),
  });
  const latest = yield* Ref.make(Option.none<HostDesiredState>());
  const preparing = yield* Ref.make(Option.none<Fiber.RuntimeFiber<unknown, unknown>>());

  const pollOnce = Effect.gen(function* () {
    const session = yield* sessions.current;
    const desired = yield* control.fetchDesiredState({
      sessionToken: session.sessionToken,
      request: {},
    });
    if (desired.hostId !== session.hostId) {
      return yield* new ForeignNibrunnerDocument({ path: config.desiredStateFile });
    }
    const previous = yield* Ref.get(latest);
    if (Option.isSome(previous) && Bun.deepEquals(previous.value, desired)) {
      return session.poll;
    }
    const wanted = yield* decode(() => nibrunnerDocument(desired));
    const worker = yield* Ref.get(preparing);
    if (Option.isSome(worker)) {
      yield* Fiber.interrupt(worker.value);
    }
    const held = yield* readNibrunnerDesired({
      path: config.desiredStateFile,
      hostId: session.hostId,
    }).pipe(
      Effect.map(Option.some),
      Effect.catchTag('MissingNibrunnerFile', () => Effect.succeedNone),
    );
    if (Option.isSome(held)) {
      yield* writeNibrunnerDocument({
        path: config.desiredStateFile,
        desired: nibrunnerWithdrawals({ held: held.value, wanted }),
      });
    }
    const prepare = Effect.gen(function* () {
      yield* stageNibrunnerArtifacts({
        desired,
        directory: config.artifactStoreDir,
        artifactBucket: config.artifactBucket,
        importBucket: config.importBucket,
      });
      yield* writeNibrunnerDocument({ path: config.desiredStateFile, desired: wanted });
    }).pipe(
      Effect.provideService(ArtifactStore, store),
      Effect.sandbox,
      Effect.tapError((cause) => Effect.logWarning('nibrunner preparation failed', cause)),
      Effect.retry(CONTROL_PLANE_BACKOFF),
    );
    yield* Ref.set(preparing, Option.some(yield* Effect.forkScoped(prepare)));
    yield* Ref.set(latest, Option.some(desired));
    return session.poll;
  }).pipe(Effect.tapErrorTag('ControlPlaneError', sessions.onExpired));

  const reportOnce = Effect.gen(function* () {
    const session = yield* sessions.current;
    const desiredDigest = yield* readNibrunnerDesiredDigest({
      path: config.desiredStateFile,
      hostId: session.hostId,
    });
    const { value } = yield* readNibrunnerReport(config.reportedStateFile);
    const report = yield* nibrunnerReportedState({
      value,
      hostId: session.hostId,
      desiredDigest,
      nowMs: yield* Clock.currentTimeMillis,
      maxAgeMs: REPORT_MAX_AGE_MS,
      admissionState: 'draining',
    });
    yield* control.sendReportedState({ sessionToken: session.sessionToken, report });
    return session.poll;
  }).pipe(Effect.tapErrorTag('ControlPlaneError', sessions.onExpired));

  return {
    pollOnce,
    reportOnce,
    run: Effect.all(
      [
        supervised({
          once: pollOnce.pipe(
            Effect.flatMap((poll) => Effect.sleep(`${poll.minIntervalMs} millis`)),
          ),
          onFailure: (cause) => Effect.logWarning('nibrunner desired poll failed', cause),
          schedule: CONTROL_PLANE_BACKOFF,
        }),
        supervised({
          once: reportOnce.pipe(
            Effect.flatMap((poll) => Effect.sleep(`${poll.reportIntervalMs} millis`)),
          ),
          onFailure: (cause) => Effect.logWarning('nibrunner report failed', cause),
          schedule: CONTROL_PLANE_BACKOFF,
        }),
      ],
      { concurrency: 'unbounded', discard: true },
    ),
  };
});
