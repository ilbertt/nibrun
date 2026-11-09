import { expect, test } from 'bun:test';
import { createConnection } from 'node:net';
import { FileSystem } from '@effect/platform';
import {
  AppIdSchema,
  DeploymentIdSchema,
  type ExportId,
  type FilesystemQueryRequest,
  type FilesystemQueryResponse,
  FilesystemQueryResultSchema,
  FilesystemQuerySchema,
  GuestPathSchema,
  type HostDesiredState,
  HostIdSchema,
  type HostReportedState,
  HostReportedStateSchema,
  type ReportedExport,
  type SqliteQueryRequest,
  type SqliteQueryResponse,
  type SqliteQueryResult,
  SqliteQueryResultSchema,
  TimestampSchema,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Deferred, Effect, Fiber, Layer, Schedule } from 'effect';
import { makeControlPlaneClient } from '#lib/control/client.ts';
import { makeNibrunnerBridge } from '#lib/nibrunner/bridge.ts';
import { nibrunnerExportReports } from '#lib/nibrunner/exports.ts';
import { makeNibrunnerFilesystem } from '#lib/nibrunner/filesystem.ts';
import type { HostReportedState as NibrunnerReport } from '#lib/nibrunner/reported.gen.ts';
import { readNibrunnerDesired, writeNibrunnerDesired } from '#lib/nibrunner/state-files.ts';
import { ArtifactStore } from '#services/artifact-store.service.ts';
import { NibrunnerBridgeConfig } from '#services/nibrunner-bridge-config.service.ts';
import { NibrunnerExports } from '#services/nibrunner-exports.service.ts';
import { NibrunnerFilesystem } from '#services/nibrunner-filesystem.service.ts';
import { NibrunnerGuestConnections } from '#services/nibrunner-guest-connections.service.ts';
import { NibrunnerLogs } from '#services/nibrunner-logs.service.ts';
import { artifactStore } from '#tests/support/artifacts.ts';
import {
  APP_ID,
  DEPLOYMENT_ID,
  desiredExport,
  desiredInstance,
  desiredState,
  desiredVolume,
  EXPORT_ID,
  HOST_ID,
  POLL_SETTINGS_FIXTURE,
} from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { serving, servingUnix } from '#tests/support/server.ts';
import { sqliteQuery } from '#tests/support/sqlite-sessions.ts';

const run = provided(platform);
const SESSION_LIFETIME_MS = 300_000;
const NEXT_DEPLOYMENT_ID = Value.Parse(DeploymentIdSchema, 'new-deployment');
const SECOND_APP_ID = Value.Parse(AppIdSchema, 'second-app');

function fixture(initialDesired: HostDesiredState) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* temporaryDirectory;
    const world = {
      desired: initialDesired,
      query: { result: 'none' } as FilesystemQueryResponse,
      sqliteQuery: { result: 'none' } as SqliteQueryResponse,
    };
    const sqliteRequests: SqliteQueryRequest[] = [];
    const sqliteResults: SqliteQueryResult[] = [];
    const guest: { connect: NibrunnerGuestConnections['connect'] } = {
      connect: () => Effect.dieMessage('No guest connection was expected'),
    };
    const filesystemRequests: FilesystemQueryRequest[] = [];
    const reports: HostReportedState[] = [];
    const registrations: string[] = [];
    const logRequests: Array<Parameters<NibrunnerLogs['send']>[0]> = [];
    const exportRequests: Array<Parameters<NibrunnerExports['sync']>[0]> = [];
    const publishedExports = new Map<ExportId, ReportedExport>();
    const exportPublishing = { run: Effect.void };
    const { baseUrl } = yield* serving(async (request) => {
      const route = new URL(request.url).pathname.split('/').at(-1);
      switch (route) {
        case 'session': {
          const body = (await request.json()) as { hostId: string };
          registrations.push(body.hostId);
          expect((await Bun.file(`${directory}/bridge/host-id`).text()).trim()).toBe(body.hostId);
          return Response.json({
            hostId: HOST_ID,
            sessionToken: 'token',
            expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS).toISOString(),
            poll: POLL_SETTINGS_FIXTURE,
          });
        }
        case 'desired-state': {
          return Response.json(world.desired);
        }
        case 'filesystem-query': {
          filesystemRequests.push((await request.json()) as FilesystemQueryRequest);
          return Response.json(world.query);
        }
        case 'filesystem-query-result': {
          Value.Parse(FilesystemQueryResultSchema, await request.json());
          return Response.json({});
        }
        case 'sqlite-query': {
          sqliteRequests.push((await request.json()) as SqliteQueryRequest);
          return Response.json(world.sqliteQuery);
        }
        case 'sqlite-query-result': {
          sqliteResults.push(Value.Parse(SqliteQueryResultSchema, await request.json()));
          return Response.json({});
        }
        default:
          reports.push(Value.Parse(HostReportedStateSchema, await request.json()));
          return Response.json({});
      }
    });
    const config = NibrunnerBridgeConfig.make({
      controlPlaneUrl: baseUrl,
      logIngestUrl: baseUrl,
      hostIdFile: `${directory}/bridge/host-id`,
      logCursorsFile: `${directory}/bridge/log-cursors.json`,
      logsDirectory: `${directory}/logs`,
      desiredStateFile: `${directory}/desired.json`,
      reportedStateFile: `${directory}/reported.json`,
      artifactStoreDir: `${directory}/artifact-store`,
      artifactBucket: 'binaries',
      importBucket: 'imports',
      exportBucket: 'exports',
      exportsDirectory: `${directory}/exports`,
      awsRegion: 'eu-central-1',
      filesystemSocket: `${directory}/filesystem.sock`,
    });
    const acceptedDigest = yield* writeNibrunnerDesired({
      path: config.desiredStateFile,
      desired: initialDesired,
    });
    const capacity = { vcpuCount: 4, memoryMib: 8192, cacheBytes: 1000 };
    const report: NibrunnerReport = {
      hostId: HOST_ID,
      reportedAt: Value.Parse(TimestampSchema, new Date().toISOString()),
      state: 'ready',
      capacity,
      allocatable: capacity,
      versions: { agent: '2026.10.7', firecracker: 'v1.16.1', guestImage: 'guest', zerofs: 'none' },
      cron: null,
      instances: [],
      volumes: [],
      checkpoints: [],
      exports: [],
      acceptedDigest,
    };
    yield* fs.writeFileString(config.reportedStateFile, JSON.stringify(report));
    return {
      config,
      world,
      reports,
      registrations,
      filesystemRequests,
      logRequests,
      exportRequests,
      publishedExports,
      exportPublishing,
      sqliteRequests,
      sqliteResults,
      guest,
      create: makeNibrunnerBridge({
        config,
        control: makeControlPlaneClient({ baseUrl }),
      }).pipe(
        Effect.provideService(
          NibrunnerExports,
          NibrunnerExports.make({
            sync: (request) =>
              Effect.sync(() => exportRequests.push(request)).pipe(
                Effect.andThen(Effect.suspend(() => exportPublishing.run)),
              ),
            reports: (request) =>
              Effect.sync(() =>
                nibrunnerExportReports({ ...request, published: publishedExports }),
              ),
          }),
        ),
        Effect.provideService(
          NibrunnerGuestConnections,
          NibrunnerGuestConnections.make({
            connect: (request) => guest.connect(request),
          }),
        ),
        Effect.provideService(
          NibrunnerLogs,
          NibrunnerLogs.make({
            send: (request) =>
              Effect.sync(() => {
                logRequests.push(request);
                return false;
              }),
          }),
        ),
        Effect.provideService(
          NibrunnerFilesystem,
          NibrunnerFilesystem.make(
            makeNibrunnerFilesystem({ socketPath: config.filesystemSocket }),
          ),
        ),
      ),
    };
  });
}

test('the bridge registers, polls and forwards draining reports across a process restart', async () => {
  await run(
    Effect.gen(function* () {
      const setup = yield* fixture(desiredState());
      const bridge = yield* setup.create.pipe(Effect.provide(artifactStore()));
      yield* bridge.pollOnce;
      yield* bridge.reportOnce;
      expect(setup.reports[0]?.state).toBe('draining');
      expect(setup.reports[0]?.hostId).toBe(HOST_ID);
      expect(setup.reports[0]).not.toHaveProperty('acceptedDigest');
      const restarted = yield* setup.create.pipe(Effect.provide(artifactStore()));
      yield* restarted.pollOnce;
      yield* restarted.reportOnce;
      expect(setup.registrations).toHaveLength(2);
      expect(new Set(setup.registrations).size).toBe(1);
      expect(setup.registrations[0]).not.toBe(HOST_ID);
    }),
  );
});

test('export publication cannot block reports or expose an intermediate native archive', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const desired = desiredState({ exports: [desiredExport()], volumes: [desiredVolume()] });
      const setup = yield* fixture(desired);
      const native: NibrunnerReport = JSON.parse(
        yield* fs.readFileString(setup.config.reportedStateFile),
      );
      native.exports = [
        { exportId: EXPORT_ID, state: 'ready', sizeBytes: 123, readyAt: native.reportedAt },
      ];
      yield* fs.writeFileString(setup.config.reportedStateFile, JSON.stringify(native));
      const bridge = yield* setup.create.pipe(Effect.provide(artifactStore()));
      yield* bridge.reportOnce;
      yield* bridge.exportsOnce;
      expect(setup.reports[0]?.exports).toEqual([]);
      expect(setup.exportRequests).toEqual([]);
      yield* bridge.pollOnce;
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      setup.exportPublishing.run = Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
      );
      const writing = yield* bridge.exportsOnce.pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      yield* bridge.reportOnce;
      expect(setup.reports[1]?.exports).toEqual([{ exportId: EXPORT_ID, state: 'preparing' }]);
      expect(setup.exportRequests[0]?.desired).toEqual(desired);
      expect(setup.exportRequests[0]?.reported).toMatchObject(native.exports);
      const published: ReportedExport = {
        exportId: EXPORT_ID,
        state: 'ready',
        sizeBytes: 456,
        readyAt: Value.Parse(TimestampSchema, native.reportedAt),
      };
      setup.publishedExports.set(EXPORT_ID, published);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(writing);
      yield* bridge.reportOnce;
      expect(setup.reports[2]?.exports).toEqual([published]);
      setup.world.desired = desiredState({
        ...desired,
        exports: [desiredExport({ desiredState: 'absent' })],
      });
      yield* bridge.pollOnce;
      yield* bridge.exportsOnce;
      yield* bridge.reportOnce;
      expect(setup.exportRequests[1]?.desired.exports[0]?.desiredState).toBe('absent');
      expect(setup.reports[3]?.exports).toEqual([]);
    }),
  );
});

test('log delivery includes stopped apps without waiting for a running guest report', async () => {
  await run(
    Effect.gen(function* () {
      const setup = yield* fixture(
        desiredState({ instances: [desiredInstance({ desiredState: 'stopped' })] }),
      );
      const bridge = yield* setup.create.pipe(Effect.provide(artifactStore()));
      expect(yield* bridge.logOnce).toBe(false);
      expect(setup.logRequests).toHaveLength(0);
      yield* bridge.pollOnce;
      yield* bridge.logOnce;
      expect(setup.logRequests[0]?.hostId).toBe(HOST_ID);
      expect(setup.logRequests[0]?.appIds).toContain(APP_ID);
    }),
  );
});

test.each(['running', 'on-request', 'stopped', 'replaced', 'stale', 'unaccepted'] as const)(
  'filesystem queries advertise only the accepted current deployment: %s',
  async (state) => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const instance = desiredInstance({
          desiredState: state === 'on-request' || state === 'stopped' ? state : 'running',
        });
        const setup = yield* fixture(desiredState({ instances: [instance] }));
        const report: NibrunnerReport = JSON.parse(
          yield* fs.readFileString(setup.config.reportedStateFile),
        );
        report.instances = [
          {
            appId: APP_ID,
            deploymentId: state === 'replaced' ? NEXT_DEPLOYMENT_ID : DEPLOYMENT_ID,
            state: state === 'on-request' ? 'idle' : 'running',
            compute: null,
            restartCount: 0,
          },
        ];
        if (state === 'stale') {
          report.reportedAt = '1970-01-01T00:00:00Z';
        }
        if (state === 'unaccepted') {
          report.acceptedDigest = null;
        }
        yield* fs.writeFileString(setup.config.reportedStateFile, JSON.stringify(report));
        setup.world.query = {
          result: 'query',
          query: Value.Parse(FilesystemQuerySchema, { queryId: 'query', appId: APP_ID, path: '/' }),
        };
        yield* servingUnix({
          socketPath: setup.config.filesystemSocket,
          handler: () => Response.json({ path: '/app/data', entries: [], truncated: false }),
        });
        const bridge = yield* setup.create.pipe(Effect.provide(artifactStore()));
        yield* bridge.filesystemOnce;
        expect(setup.filesystemRequests).toEqual([
          { servedAppIds: state === 'running' || state === 'on-request' ? [APP_ID] : [] },
        ]);
      }),
    );
  },
);

function sqliteAnswer(results: readonly SqliteQueryResult[]) {
  return Effect.sync(() => results.length).pipe(
    Effect.repeat({ schedule: Schedule.spaced('5 millis'), until: (length) => length > 0 }),
    Effect.timeout('2 seconds'),
  );
}

function sqliteInstance(state: string) {
  return desiredInstance({
    desiredState: state === 'idle' ? 'on-request' : state === 'stopped' ? 'stopped' : 'running',
  });
}

function sqliteObservedState(state: string): NibrunnerReport['instances'][number]['state'] {
  return state === 'idle' ? 'idle' : state === 'failed' ? 'failed' : 'running';
}

test.each([
  'running',
  'idle',
  'stopped',
  'replaced',
  'stale',
  'unaccepted',
  'failed',
  'unpolled',
] as const)('SQLite polls advertise only current usable deployments: %s', async (state) => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const instance = sqliteInstance(state);
      const setup = yield* fixture(desiredState({ instances: [instance] }));
      const report: NibrunnerReport = JSON.parse(
        yield* fs.readFileString(setup.config.reportedStateFile),
      );
      report.instances = [
        {
          appId: APP_ID,
          deploymentId: state === 'replaced' ? NEXT_DEPLOYMENT_ID : DEPLOYMENT_ID,
          state: sqliteObservedState(state),
          compute: null,
          restartCount: 0,
        },
      ];
      if (state === 'stale') {
        report.reportedAt = '1970-01-01T00:00:00Z';
      }
      if (state === 'unaccepted') {
        report.acceptedDigest = null;
      }
      yield* fs.writeFileString(setup.config.reportedStateFile, JSON.stringify(report));
      setup.world.sqliteQuery = { result: 'query', query: sqliteQuery({ type: 'close' }) };
      const bridge = yield* setup.create.pipe(Effect.provide(artifactStore()));
      if (state !== 'unpolled') {
        yield* bridge.pollOnce;
      }
      yield* bridge.sqliteOnce;
      yield* sqliteAnswer(setup.sqliteResults);
      expect(setup.sqliteRequests).toEqual([
        {
          servedDeployments:
            state === 'running' || state === 'idle'
              ? [{ appId: APP_ID, deploymentId: DEPLOYMENT_ID }]
              : [],
        },
      ]);
      expect(setup.sqliteResults[0]?.outcome.status).toBe('failed');
    }),
  );
});

test('a stop closes the SQLite session before publishing the engine withdrawal', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const setup = yield* fixture(desiredState({ instances: [desiredInstance()] }));
      const report: NibrunnerReport = JSON.parse(
        yield* fs.readFileString(setup.config.reportedStateFile),
      );
      report.instances = [
        {
          appId: APP_ID,
          deploymentId: DEPLOYMENT_ID,
          state: 'running',
          compute: null,
          restartCount: 0,
        },
      ];
      yield* fs.writeFileString(setup.config.reportedStateFile, JSON.stringify(report));
      const closedBeforeWithdrawal: string[] = [];
      yield* servingUnix({
        socketPath: setup.config.filesystemSocket,
        handler: () => Response.json({}),
      });
      setup.guest.connect = () =>
        Effect.acquireRelease(
          Effect.sync(() => createConnection({ path: setup.config.filesystemSocket })),
          (socket) =>
            Effect.gen(function* () {
              socket.destroy();
              const held = yield* readNibrunnerDesired({
                path: setup.config.desiredStateFile,
                hostId: HOST_ID,
              });
              closedBeforeWithdrawal.push(held.instances[0]?.desiredState ?? 'removed');
            }).pipe(Effect.provideService(FileSystem.FileSystem, fs), Effect.orDie),
        );
      setup.world.sqliteQuery = {
        result: 'query',
        query: sqliteQuery({ type: 'open', path: Value.Parse(GuestPathSchema, '/app.db') }),
      };
      const bridge = yield* setup.create.pipe(Effect.provide(artifactStore()));
      yield* bridge.pollOnce;
      yield* bridge.sqliteOnce;
      yield* sqliteAnswer(setup.sqliteResults);
      expect(setup.sqliteResults[0]?.outcome).toEqual({ status: 'opened' });
      setup.world.desired = desiredState({
        instances: [desiredInstance({ desiredState: 'stopped' })],
      });
      yield* bridge.pollOnce;
      expect(closedBeforeWithdrawal).toEqual(['running']);
    }),
  );
});

test('stops and removals bypass a blocked download without omitting an unrelated running app', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const first = desiredInstance();
      const second = desiredInstance({ appId: SECOND_APP_ID });
      const setup = yield* fixture(desiredState({ instances: [first, second] }));
      const opened = yield* Deferred.make<void>();
      const store = Layer.succeed(
        ArtifactStore,
        ArtifactStore.make({
          open: () =>
            Deferred.succeed(opened, undefined).pipe(Effect.as(new ReadableStream<Uint8Array>())),
        }),
      );
      const bridge = yield* setup.create.pipe(Effect.provide(store));
      setup.world.desired = desiredState({
        instances: [
          desiredInstance({ deploymentId: NEXT_DEPLOYMENT_ID }),
          desiredInstance({ appId: SECOND_APP_ID, desiredState: 'stopped' }),
        ],
      });
      yield* bridge.pollOnce;
      yield* Deferred.await(opened);
      const held = yield* readNibrunnerDesired({
        path: setup.config.desiredStateFile,
        hostId: HOST_ID,
      });
      expect(held.revision.startsWith('preparing-')).toBe(true);
      expect(
        held.instances.map((instance) => [
          instance.appId,
          instance.deploymentId,
          instance.desiredState,
        ]),
      ).toEqual([
        [first.appId, first.deploymentId, first.desiredState],
        [second.appId, second.deploymentId, 'stopped'],
      ]);
      setup.world.desired = desiredState({
        instances: [desiredInstance({ appId: SECOND_APP_ID, desiredState: 'stopped' })],
      });
      yield* bridge.pollOnce;
      const withdrawn = yield* readNibrunnerDesired({
        path: setup.config.desiredStateFile,
        hostId: HOST_ID,
      });
      expect(withdrawn.instances.map((instance) => instance.appId)).toEqual([SECOND_APP_ID]);
      expect(yield* fs.readDirectory(setup.config.artifactStoreDir)).toEqual([]);
    }),
  );
});

test('new deployments reach the engine only after their verified artifact is staged', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const setup = yield* fixture(desiredState());
      const bridge = yield* setup.create.pipe(Effect.provide(artifactStore()));
      const instance = desiredInstance({ deploymentId: NEXT_DEPLOYMENT_ID });
      setup.world.desired = desiredState({ instances: [instance] });
      yield* bridge.pollOnce;
      yield* readNibrunnerDesired({
        path: setup.config.desiredStateFile,
        hostId: HOST_ID,
      }).pipe(
        Effect.repeat({
          schedule: Schedule.spaced('5 millis'),
          until: (document) => document.instances.length > 0,
        }),
        Effect.timeout('2 seconds'),
      );
      const published = yield* readNibrunnerDesired({
        path: setup.config.desiredStateFile,
        hostId: HOST_ID,
      });
      expect(published.instances[0]?.deploymentId).toBe(NEXT_DEPLOYMENT_ID);
      expect(yield* fs.exists(`${setup.config.artifactStoreDir}/${instance.artifact.digest}`)).toBe(
        true,
      );
    }),
  );
});

test('foreign control-plane desired state cannot replace the host document', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const setup = yield* fixture(desiredState());
      const before = yield* fs.readFileString(setup.config.desiredStateFile);
      const bridge = yield* setup.create.pipe(Effect.provide(artifactStore()));
      setup.world.desired = desiredState({ hostId: Value.Parse(HostIdSchema, 'another-host') });
      expect((yield* Effect.flip(bridge.pollOnce))._tag).toBe('ForeignNibrunnerDocument');
      expect(yield* fs.readFileString(setup.config.desiredStateFile)).toBe(before);
    }),
  );
});
