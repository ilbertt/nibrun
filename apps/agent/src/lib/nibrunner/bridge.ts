import type { HostDesiredState } from '@repo/protocol';
import { Clock, Context, Effect, Fiber, Layer, Option, Ref } from 'effect';
import { CONTROL_PLANE_BACKOFF } from '#lib/agent/backoff.ts';
import { supervised } from '#lib/agent/loop.ts';
import type { ControlPlaneClient } from '#lib/control/client.ts';
import { makeSessionHolder } from '#lib/control/session.ts';
import { nibrunnerCronListings, pollNibrunnerCron } from '#lib/nibrunner/cron-query.ts';
import { pollNibrunnerFilesystem } from '#lib/nibrunner/filesystem-query.ts';
import { nibrunnerQueryDeployments } from '#lib/nibrunner/query-deployments.ts';
import { nibrunnerReportedState } from '#lib/nibrunner/reported-state.ts';
import { makeNibrunnerSqliteGuest } from '#lib/nibrunner/sqlite-guest.ts';
import { stageNibrunnerArtifacts } from '#lib/nibrunner/stage-artifacts.ts';
import {
  ForeignNibrunnerDocument,
  nibrunnerDocument,
  readNibrunnerDesired,
  readNibrunnerDesiredDocument,
  readNibrunnerReport,
  writeNibrunnerDocument,
} from '#lib/nibrunner/state-files.ts';
import { nibrunnerWithdrawals } from '#lib/nibrunner/withdrawals.ts';
import { decode } from '#lib/protocol.ts';
import { makeSqliteQueryPoll } from '#lib/sqlite/query-poll.ts';
import { ArtifactStore } from '#services/artifact-store.service.ts';
import type { NibrunnerBridgeConfig } from '#services/nibrunner-bridge-config.service.ts';
import { NibrunnerFilesystem } from '#services/nibrunner-filesystem.service.ts';
import { NibrunnerLogs } from '#services/nibrunner-logs.service.ts';
import { SqliteGuest } from '#services/sqlite-guest.service.ts';
import { SqliteSessions } from '#services/sqlite-sessions.service.ts';

const REPORT_MAX_AGE_MS = 30_000;
const LOG_IDLE_POLL = '500 millis';

export const makeNibrunnerBridge = Effect.fn('makeNibrunnerBridge')(function* ({
  control,
  config,
}: {
  control: ControlPlaneClient;
  config: NibrunnerBridgeConfig;
}) {
  const store = yield* ArtifactStore;
  const filesystem = yield* NibrunnerFilesystem;
  const logs = yield* NibrunnerLogs;
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
    yield* sqlite.syncDeployments(desired);
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

  const currentState = Effect.gen(function* () {
    const session = yield* sessions.current;
    const { desired, digest } = yield* readNibrunnerDesiredDocument({
      path: config.desiredStateFile,
      hostId: session.hostId,
    });
    const { value } = yield* readNibrunnerReport(config.reportedStateFile);
    const report = yield* nibrunnerReportedState({
      value,
      hostId: session.hostId,
      desiredDigest: digest,
      nowMs: yield* Clock.currentTimeMillis,
      maxAgeMs: REPORT_MAX_AGE_MS,
      admissionState: 'draining',
    });
    return { session, report, desired, value };
  });

  const sqliteDeployments = Effect.gen(function* () {
    const wanted = Option.getOrUndefined(yield* Ref.get(latest));
    if (wanted === undefined) {
      return [];
    }
    const { desired, report } = yield* currentState;
    return nibrunnerQueryDeployments({ desired, report }).filter(
      (instance) =>
        instance.desiredState !== 'stopped' &&
        wanted.instances.some(
          (candidate) =>
            candidate.appId === instance.appId &&
            candidate.deploymentId === instance.deploymentId &&
            candidate.desiredState !== 'stopped',
        ) &&
        report.instances.some(
          (candidate) =>
            candidate.appId === instance.appId &&
            candidate.deploymentId === instance.deploymentId &&
            ['starting', 'running', 'idle', 'unhealthy'].includes(candidate.state),
        ),
    );
  });
  const sqliteGuest = yield* makeNibrunnerSqliteGuest({ deployments: sqliteDeployments });
  const sqlite = Context.get(
    yield* Layer.build(
      SqliteSessions.DefaultWithoutDependencies.pipe(
        Layer.provide(Layer.succeed(SqliteGuest, sqliteGuest)),
      ),
    ),
    SqliteSessions,
  );
  const sqliteOnce = yield* makeSqliteQueryPoll({
    control,
    currentSession: sessions.current,
    servedDeployments: sqliteDeployments.pipe(
      Effect.map((instances) =>
        instances.map(({ appId, deploymentId }) => ({ appId, deploymentId })),
      ),
    ),
    onExpired: sessions.onExpired,
    sessions: sqlite,
  });

  const reportOnce = Effect.gen(function* () {
    const { session, report } = yield* currentState;
    yield* control.sendReportedState({ sessionToken: session.sessionToken, report });
    return session.poll;
  }).pipe(Effect.tapErrorTag('ControlPlaneError', sessions.onExpired));

  const servedAppIds = Effect.gen(function* () {
    const { desired, report } = yield* currentState;
    return nibrunnerQueryDeployments({ desired, report })
      .filter((instance) => instance.desiredState !== 'stopped')
      .map((instance) => instance.appId);
  });

  const cronListings = Effect.gen(function* () {
    const { value, desired, report } = yield* currentState;
    const deployments = nibrunnerQueryDeployments({ desired, report });
    const listings = yield* nibrunnerCronListings(value);
    return listings.filter((listing) =>
      deployments.some(
        (deployment) =>
          deployment.appId === listing.appId && deployment.deploymentId === listing.deploymentId,
      ),
    );
  });

  const cronOnce = Effect.gen(function* () {
    return yield* pollNibrunnerCron({
      control,
      session: yield* sessions.current,
      listings: cronListings,
    });
  }).pipe(Effect.tapErrorTag('ControlPlaneError', sessions.onExpired));

  const filesystemOnce = Effect.gen(function* () {
    return yield* pollNibrunnerFilesystem({
      control,
      session: yield* sessions.current,
      servedAppIds,
    });
  }).pipe(
    Effect.provideService(NibrunnerFilesystem, filesystem),
    Effect.tapErrorTag('ControlPlaneError', sessions.onExpired),
  );

  const logOnce = Effect.gen(function* () {
    const desired = Option.getOrUndefined(yield* Ref.get(latest));
    if (desired === undefined) {
      return false;
    }
    const session = yield* sessions.current;
    return yield* logs.send({
      hostId: session.hostId,
      appIds: [...desired.instances, ...desired.volumes].map((app) => app.appId),
    });
  }).pipe(Effect.tapErrorTag('ControlPlaneError', sessions.onExpired));

  return {
    pollOnce,
    reportOnce,
    filesystemOnce,
    cronOnce,
    logOnce,
    sqliteOnce,
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
        supervised({
          once: filesystemOnce,
          onFailure: () => Effect.logWarning('nibrunner filesystem query failed'),
          schedule: CONTROL_PLANE_BACKOFF,
        }),
        supervised({
          once: cronOnce,
          onFailure: () => Effect.logWarning('nibrunner cron query failed'),
          schedule: CONTROL_PLANE_BACKOFF,
        }),
        supervised({
          once: sqliteOnce,
          onFailure: () => Effect.logWarning('nibrunner SQLite query failed'),
          schedule: CONTROL_PLANE_BACKOFF,
        }),
        supervised({
          once: logOnce.pipe(
            Effect.flatMap((sent) => (sent ? Effect.void : Effect.sleep(LOG_IDLE_POLL))),
          ),
          onFailure: () => Effect.logWarning('nibrunner tenant log delivery failed'),
          schedule: CONTROL_PLANE_BACKOFF,
        }),
      ],
      { concurrency: 'unbounded', discard: true },
    ),
  };
});
