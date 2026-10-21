import { describe, expect, test } from 'bun:test';
import { FetchHttpClient } from '@effect/platform';
import { DESIRED_PRESENCE } from '@repo/protocol';
import { Effect, Layer, Option } from 'effect';
import { exportCheckpointId } from '#lib/exports/checkpoint.ts';
import { describeSlot, FIRST_SLOT } from '#lib/network/slot.ts';
import { applyCheckpoints } from '#lib/reconcile/checkpoints.ts';
import { applyExports } from '#lib/reconcile/exports.ts';
import { planReconcile } from '#lib/reconcile/plan.ts';
import { appZerofsFilesystem } from '#lib/volumes/app-zerofs-filesystem.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { ArtifactStore } from '#services/artifact-store.service.ts';
import { ExportManager } from '#services/export-manager.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { recordingCommands } from '#tests/support/commands.ts';
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

function registerPrivateFilesystem() {
  return Effect.gen(function* () {
    const topology = yield* ZerofsTopology;
    const storage = s3Storage();
    const filesystem = yield* appZerofsFilesystem({
      appId: APP_ID,
      storagePrefix: storage.prefix,
    }).pipe(Effect.provide(agentConfig()));
    yield* topology.registerAppFilesystem({ appId: APP_ID, filesystem, storage });
  });
}

describe('operations that still require shared storage', () => {
  test.each(
    DESIRED_PRESENCE.flatMap((desiredPresence) => [
      { desiredPresence, configured: true },
      { desiredPresence, configured: false },
    ]),
  )(
    'private volume checkpoints fail without using the shared backend: %j',
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
      await provided(Layer.mergeAll(AgentState.Default, topology, commands.layer))(
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
