import { describe, expect, test } from 'bun:test';
import { dirname } from 'node:path';
import { FetchHttpClient, FileSystem } from '@effect/platform';
import { DESIRED_PRESENCE } from '@repo/protocol';
import { Effect, Layer, Option } from 'effect';
import { exportCheckpointId } from '#lib/exports/checkpoint.ts';
import { describeSlot, FIRST_SLOT } from '#lib/network/slot.ts';
import { applyCheckpoints } from '#lib/reconcile/checkpoints.ts';
import { applyExports } from '#lib/reconcile/exports.ts';
import { planReconcile } from '#lib/reconcile/plan.ts';
import { hasPendingAppRetirements } from '#lib/reconcile/volumes.ts';
import { appZerofsFilesystem } from '#lib/volumes/app-zerofs-filesystem.ts';
import { deletedVolumeReport } from '#lib/volumes/teardown.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { ArtifactStore } from '#services/artifact-store.service.ts';
import { ExportManager } from '#services/export-manager.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { agentConfig } from '#tests/support/config.ts';
import {
  APP_ID,
  CHECKPOINT_ID,
  desiredCheckpoint,
  desiredExport,
  desiredState,
  desiredVolume,
  EXPORT_ID,
  OBSERVED_AT,
  observedState,
  VOLUME_ID,
  VOLUME_SIZE_BYTES,
} from '#tests/support/fixtures.ts';
import { platform, provided } from '#tests/support/run.ts';
import { s3Storage } from '#tests/support/s3-storage.ts';
import { CHECKPOINT_TABLE, EMPTY_CHECKPOINT_LIST } from '#tests/support/zerofs-checkpoints.ts';

function registerPrivateFilesystem() {
  return Effect.gen(function* () {
    const topology = yield* ZerofsTopology;
    const storage = s3Storage();
    const filesystem = yield* appZerofsFilesystem({
      appId: APP_ID,
      storagePrefix: storage.prefix,
    }).pipe(Effect.provide(agentConfig({ stateDir: '/var/lib/nibrun' })));
    yield* topology.registerAppFilesystem({ appId: APP_ID, filesystem, storage });
    return filesystem;
  });
}

function checkpointHost({
  configured,
  listed,
  failAt,
}: {
  configured: boolean;
  listed: boolean;
  failAt: 'list' | 'create' | 'delete' | undefined;
}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const info = yield* fs.stat('/');
    const topology = yield* ZerofsTopology.pipe(
      Effect.provide(ZerofsTopology.DefaultWithoutDependencies.pipe(Layer.provide(agentConfig()))),
    );
    const filesystem = configured
      ? yield* registerPrivateFilesystem().pipe(Effect.provideService(ZerofsTopology, topology))
      : topology.place();
    const mounts = new Set([topology.place().mountPath, filesystem.mountPath]);
    const parents = new Set([...mounts].map(dirname));
    const commands = recordingCommands(({ command }) =>
      succeeding({
        code: command[2] === failAt ? 1 : 0,
        stdout: configured
          ? listed
            ? CHECKPOINT_TABLE
            : EMPTY_CHECKPOINT_LIST
          : listed
            ? `${CHECKPOINT_ID}\n`
            : '',
        stderr: 'customer-secret-key',
      }),
    );
    const layer = Layer.mergeAll(
      AgentState.Default,
      Layer.succeed(ZerofsTopology, topology),
      commands.layer,
      Layer.succeed(FileSystem.FileSystem, {
        ...fs,
        exists: () => Effect.succeed(false),
        stat: (path) =>
          mounts.has(path)
            ? Effect.succeed({ ...info, dev: info.dev + 1 })
            : parents.has(path)
              ? Effect.succeed(info)
              : fs.stat(path),
      }),
    );
    return { commands, layer, filesystem };
  });
}

describe('storage-specific operations', () => {
  test.each(
    DESIRED_PRESENCE.flatMap((desiredPresence) =>
      [false, true].flatMap((configured) =>
        [false, true].map((listed) => ({ desiredPresence, configured, listed })),
      ),
    ),
  )(
    'checkpoints use only their selected writer and tolerate retries: %j',
    async ({ desiredPresence, configured, listed }) => {
      const sharedRemoval = desiredPresence === 'absent' && !configured;
      await provided(platform)(
        Effect.gen(function* () {
          const host = yield* checkpointHost({ configured, listed, failAt: undefined });
          const desired = desiredState({
            volumes: [desiredVolume(configured ? { storage: s3Storage() } : {})],
            checkpoints: [desiredCheckpoint({ desiredState: desiredPresence })],
          });
          const observed = observedState({
            checkpoints: sharedRemoval
              ? [{ checkpointId: CHECKPOINT_ID, volumeId: VOLUME_ID }]
              : [],
          });
          yield* Effect.gen(function* () {
            yield* applyCheckpoints({ plan: planReconcile({ desired, observed }), desired });
            expect((yield* AgentState.snapshot).checkpointReports[0]?.state).toBe(
              desiredPresence === 'present' ? 'ready' : 'pending',
            );
          }).pipe(Effect.provide(host.layer));
          const { binary, configFile } = host.filesystem.admin;
          const operation = desiredPresence === 'present' ? 'create' : 'delete';
          const changes = desiredPresence === 'present' ? !listed : listed;
          expect(host.commands.commands.map(({ command }) => command)).toEqual([
            [binary, 'checkpoint', 'list', '-c', configFile],
            ...(changes
              ? [[binary, 'checkpoint', operation, '-c', configFile, CHECKPOINT_ID] as const]
              : []),
          ]);
        }),
      );
    },
  );

  test('a changed bucket is rejected before issuing checkpoint commands', async () => {
    await provided(platform)(
      Effect.gen(function* () {
        const host = yield* checkpointHost({ configured: true, listed: false, failAt: undefined });
        const desired = desiredState({
          volumes: [desiredVolume({ storage: s3Storage({ bucket: 'another-bucket' }) })],
          checkpoints: [desiredCheckpoint()],
        });
        yield* Effect.gen(function* () {
          yield* applyCheckpoints({
            plan: planReconcile({ desired, observed: observedState() }),
            desired,
          });
          expect((yield* AgentState.snapshot).checkpointReports[0]?.state).toBe('failed');
        }).pipe(Effect.provide(host.layer));
        expect(host.commands.commands).toEqual([]);
      }),
    );
  });

  test.each(DESIRED_PRESENCE)(
    'an unreadable configured checkpoint listing refuses %s mutations without falling back',
    async (desiredPresence) => {
      await provided(platform)(
        Effect.gen(function* () {
          const host = yield* checkpointHost({
            configured: true,
            listed: false,
            failAt: undefined,
          });
          const commands = recordingCommands(() => succeeding({ stdout: 'customer-secret-key' }));
          const desired = desiredState({
            volumes: [desiredVolume({ storage: s3Storage() })],
            checkpoints: [desiredCheckpoint({ desiredState: desiredPresence })],
          });
          yield* Effect.gen(function* () {
            yield* applyCheckpoints({
              plan: planReconcile({ desired, observed: observedState() }),
              desired,
            }).pipe(Effect.provide(commands.layer));
            const report = (yield* AgentState.snapshot).checkpointReports[0];
            expect(report?.state).toBe('failed');
            expect(JSON.stringify(report)).not.toContain('customer-secret-key');
          }).pipe(Effect.provide(host.layer));
          expect(commands.commands.map(({ command }) => command)).toEqual([
            [
              host.filesystem.admin.binary,
              'checkpoint',
              'list',
              '-c',
              host.filesystem.admin.configFile,
            ],
          ]);
          expect(host.commands.commands).toEqual([]);
        }),
      );
    },
  );

  test.each(['list', 'create', 'delete'] as const)(
    'a private checkpoint %s failure is sanitized without falling back',
    async (failAt) => {
      await provided(platform)(
        Effect.gen(function* () {
          const deleting = failAt === 'delete';
          const host = yield* checkpointHost({ configured: true, listed: deleting, failAt });
          const desired = desiredState({
            volumes: [desiredVolume({ storage: s3Storage() })],
            checkpoints: [desiredCheckpoint({ desiredState: deleting ? 'absent' : 'present' })],
          });
          const observed = observedState();
          yield* Effect.gen(function* () {
            yield* applyCheckpoints({ plan: planReconcile({ desired, observed }), desired });
            const report = (yield* AgentState.snapshot).checkpointReports[0];
            expect(report?.state).toBe('failed');
            expect(JSON.stringify(report)).not.toContain('customer-secret-key');
          }).pipe(Effect.provide(host.layer));
          expect(host.commands.commands.length).toBeGreaterThan(0);
          expect(
            host.commands.commands.every(({ command }) =>
              command.includes(host.filesystem.admin.configFile),
            ),
          ).toBe(true);
        }),
      );
    },
  );

  test('only incomplete configured deletions require another retirement pass', () => {
    const wanted = desiredVolume({ desiredState: 'absent', storage: s3Storage() });
    expect(hasPendingAppRetirements({ desiredVolumes: [wanted], deletedVolumes: new Map() })).toBe(
      true,
    );
    expect(
      hasPendingAppRetirements({
        desiredVolumes: [wanted],
        deletedVolumes: new Map([[wanted.volumeId, deletedVolumeReport(wanted)]]),
      }),
    ).toBe(false);
    expect(
      hasPendingAppRetirements({
        desiredVolumes: [desiredVolume({ desiredState: 'absent' })],
        deletedVolumes: new Map(),
      }),
    ).toBe(false);
    expect(
      hasPendingAppRetirements({
        desiredVolumes: [desiredVolume({ storage: s3Storage() })],
        deletedVolumes: new Map(),
      }),
    ).toBe(false);
  });

  test.each(
    DESIRED_PRESENCE.flatMap((desiredPresence) => [
      { desiredPresence, configured: true },
      { desiredPresence, configured: false },
    ]),
  )(
    'unavailable or unconfigured private volumes cannot checkpoint shared storage: %j',
    async ({ desiredPresence, configured }) => {
      const commands = recordingCommands();
      const desired = desiredState({
        volumes: [desiredVolume(configured ? { storage: s3Storage() } : {})],
        checkpoints: [desiredCheckpoint({ desiredState: desiredPresence })],
      });
      const observed = observedState({
        checkpoints:
          desiredPresence === 'absent'
            ? [{ checkpointId: CHECKPOINT_ID, volumeId: VOLUME_ID }]
            : [],
      });
      const topology = ZerofsTopology.DefaultWithoutDependencies.pipe(Layer.provide(agentConfig()));
      await provided(Layer.mergeAll(AgentState.Default, topology, commands.layer, platform))(
        Effect.gen(function* () {
          if (!configured) {
            yield* registerPrivateFilesystem();
          }
          yield* applyCheckpoints({ plan: planReconcile({ desired, observed }), desired });
          expect((yield* AgentState.snapshot).checkpointReports[0]?.state).toBe('failed');
          expect(commands.commands).toEqual([]);
        }),
      );
    },
  );

  test.each([
    { configured: true, registered: false },
    { configured: false, registered: false },
    { configured: false, registered: true },
  ])(
    'exports use the shared writer only for shared volumes: %j',
    async ({ configured, registered }) => {
      const privateStorage = configured || registered;
      let writes = 0;
      let reaps = 0;
      const writer = Layer.succeed(
        ExportManager,
        ExportManager.make({
          write: ({ desired }) =>
            Effect.sync(() => {
              writes += 1;
              return {
                exportId: desired.exportId,
                checkpointId: exportCheckpointId(desired.exportId),
                state: 'ready' as const,
                sizeBytes: VOLUME_SIZE_BYTES,
                readyAt: OBSERVED_AT,
              };
            }),
          reap: Effect.sync(() => {
            reaps += 1;
          }),
        }),
      );
      const slot = describeSlot({ slot: FIRST_SLOT, appId: APP_ID });
      const allocator = Layer.succeed(
        SlotAllocator,
        SlotAllocator.make({
          allocateWithNbdDevice: () => Effect.die('unexpected allocation'),
          allocate: () => Effect.die('unexpected allocation'),
          lookup: () => Effect.succeed(Option.some(slot)),
          release: () => Effect.void,
          slots: Effect.succeed([slot]),
          persist: Effect.void,
        }),
      );
      const commands = recordingCommands();
      const desired = desiredState({
        volumes: [desiredVolume(configured ? { storage: s3Storage() } : {})],
        exports: [desiredExport()],
      });
      await provided(
        Layer.mergeAll(
          platform,
          FetchHttpClient.layer,
          AgentState.Default,
          writer,
          allocator,
          commands.layer,
          agentConfig(),
          ZerofsTopology.DefaultWithoutDependencies.pipe(Layer.provide(agentConfig())),
          Layer.succeed(
            ArtifactStore,
            ArtifactStore.make({ open: () => Effect.die('unexpected artifact download') }),
          ),
        ),
      )(
        Effect.gen(function* () {
          if (registered) {
            yield* registerPrivateFilesystem();
          }
          yield* applyExports({
            plan: planReconcile({ desired, observed: observedState() }),
            desired,
          });
          expect((yield* AgentState.snapshot).exportReports.get(EXPORT_ID)?.state).toBe(
            privateStorage ? 'failed' : 'ready',
          );
          expect(writes).toBe(privateStorage ? 0 : 1);
          expect(reaps).toBe(1);
        }),
      );
    },
  );
});
