import { expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import {
  AppIdSchema,
  DeploymentIdSchema,
  type HostDesiredState,
  HostIdSchema,
  type HostReportedState,
  HostReportedStateSchema,
  TimestampSchema,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Deferred, Effect, Layer, Schedule } from 'effect';
import { makeControlPlaneClient } from '#lib/control/client.ts';
import { makeNibrunnerBridge } from '#lib/nibrunner/bridge.ts';
import type { HostReportedState as NibrunnerReport } from '#lib/nibrunner/reported.gen.ts';
import { readNibrunnerDesired, writeNibrunnerDesired } from '#lib/nibrunner/state-files.ts';
import { ArtifactStore } from '#services/artifact-store.service.ts';
import { NibrunnerBridgeConfig } from '#services/nibrunner-bridge-config.service.ts';
import { artifactStore } from '#tests/support/artifacts.ts';
import {
  desiredInstance,
  desiredState,
  HOST_ID,
  POLL_SETTINGS_FIXTURE,
} from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { serving } from '#tests/support/server.ts';

const run = provided(platform);
const SESSION_LIFETIME_MS = 300_000;
const NEXT_DEPLOYMENT_ID = Value.Parse(DeploymentIdSchema, 'new-deployment');
const SECOND_APP_ID = Value.Parse(AppIdSchema, 'second-app');

function fixture(initialDesired: HostDesiredState) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* temporaryDirectory;
    const world = { desired: initialDesired };
    const reports: HostReportedState[] = [];
    const registrations: string[] = [];
    const { baseUrl } = yield* serving(async (request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith('/session')) {
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
      if (path.endsWith('/desired-state')) {
        return Response.json(world.desired);
      }
      reports.push(Value.Parse(HostReportedStateSchema, await request.json()));
      return Response.json({});
    });
    const config = NibrunnerBridgeConfig.make({
      controlPlaneUrl: baseUrl,
      hostIdFile: `${directory}/bridge/host-id`,
      desiredStateFile: `${directory}/desired.json`,
      reportedStateFile: `${directory}/reported.json`,
      artifactStoreDir: `${directory}/artifact-store`,
      artifactBucket: 'binaries',
      importBucket: 'imports',
      awsRegion: 'eu-central-1',
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
      create: makeNibrunnerBridge({
        config,
        control: makeControlPlaneClient({ baseUrl }),
      }),
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
