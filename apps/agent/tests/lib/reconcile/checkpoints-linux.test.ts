import { expect, test } from 'bun:test';
import type { DesiredCheckpoint, DesiredVolume } from '@repo/protocol';
import { Effect, Layer, Option } from 'effect';
import { applyCheckpoints } from '#lib/reconcile/checkpoints.ts';
import { planReconcile } from '#lib/reconcile/plan.ts';
import { createCheckpoint, listCheckpoints } from '#lib/volumes/zerofs.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { AppVolumeFiles } from '#services/app-volume-files.service.ts';
import { CommandRunner } from '#services/command-runner.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import {
  CHECKPOINT_ID,
  desiredCheckpoint,
  desiredState,
  desiredVolume,
  observedState,
  VOLUME_ID,
  VOLUME_SIZE_BYTES,
} from '#tests/support/fixtures.ts';
import { platform, provided } from '#tests/support/run.ts';
import { s3Backend } from '#tests/support/s3-backend.ts';
import { s3Storage } from '#tests/support/s3-storage.ts';
import { configuredZerofs } from '#tests/support/zerofs.ts';

const TEST_TIMEOUT_MS = 300_000;
const run = provided(
  Layer.merge(CommandRunner.Default, AppVolumeFiles.Default).pipe(Layer.provideMerge(platform)),
);

function reconcileCheckpoint({
  volume,
  presence,
}: {
  volume: DesiredVolume;
  presence: DesiredCheckpoint['desiredState'];
}) {
  return Effect.gen(function* () {
    const desired = desiredState({
      volumes: [volume],
      checkpoints: [desiredCheckpoint({ desiredState: presence })],
    });
    const observed = observedState({
      checkpoints:
        presence === 'absent' ? [{ checkpointId: CHECKPOINT_ID, volumeId: VOLUME_ID }] : [],
    });
    yield* applyCheckpoints({ plan: planReconcile({ desired, observed }), desired });
    const { checkpointReports } = yield* AgentState.snapshot;
    expect(checkpointReports).toHaveLength(1);
    expect(checkpointReports[0]).toMatchObject({
      checkpointId: CHECKPOINT_ID,
      volumeId: VOLUME_ID,
      state: presence === 'present' ? 'ready' : 'pending',
      ...(presence === 'present' ? { reference: CHECKPOINT_ID } : {}),
    });
  });
}

test.skipIf(process.platform !== 'linux' || process.env.NIBRUN_TEST_ZEROFS !== '1')(
  'configured checkpoint reconciliation persists across ZeroFS recovery and leaves shared checkpoints intact',
  async () => {
    await run(
      Effect.gen(function* () {
        const files = yield* AppVolumeFiles;
        const backend = yield* s3Backend();
        const app = yield* configuredZerofs(backend);
        const shared = yield* configuredZerofs({
          ...backend,
          storage: s3Storage({ ...backend.storage, prefix: 'shared-checkpoint-fixture' }),
        });
        const volume = desiredVolume({ appId: app.appId, storage: backend.storage });
        const input = { mountPath: app.paths.mountPath, volumeId: VOLUME_ID };
        const create = reconcileCheckpoint({ volume, presence: 'present' });
        const remove = reconcileCheckpoint({ volume, presence: 'absent' });
        const topology = ZerofsTopology.DefaultWithoutDependencies.pipe(
          Layer.provide(
            agentConfig({
              zerofsMount: shared.filesystem.mountPath,
              zerofsNbdSocket: shared.filesystem.nbdSocketPath,
              zerofsBinary: shared.admin.binary,
              zerofsConfigFile: shared.admin.configFile,
              zerofsStoragePrefix: shared.filesystem.storagePrefix,
            }),
          ),
        );
        yield* shared.run(
          Effect.gen(function* () {
            yield* createCheckpoint({ target: shared.admin, checkpointId: CHECKPOINT_ID });
            yield* app.run(
              Effect.gen(function* () {
                yield* (yield* ZerofsTopology).registerAppFilesystem({
                  appId: app.appId,
                  storage: backend.storage,
                  filesystem: app.filesystem,
                });
                yield* files.ensure({ ...input, sizeBytes: VOLUME_SIZE_BYTES });
                expect(yield* listCheckpoints(app.admin)).toEqual([]);
                yield* create;
                yield* create;
                expect(yield* listCheckpoints(app.admin)).toEqual([CHECKPOINT_ID]);
                expect(yield* listCheckpoints(shared.admin)).toEqual([CHECKPOINT_ID]);
              }),
            );
            yield* app.clearCache;
            yield* app.run(
              Effect.gen(function* () {
                expect(yield* listCheckpoints(app.admin)).toEqual([CHECKPOINT_ID]);
                yield* remove;
                yield* remove;
                expect(yield* listCheckpoints(app.admin)).toEqual([]);
                expect(yield* listCheckpoints(shared.admin)).toEqual([CHECKPOINT_ID]);
              }),
            );
            yield* app.clearCache;
            yield* app.run(
              Effect.gen(function* () {
                expect(yield* listCheckpoints(app.admin)).toEqual([]);
                expect(Option.getOrThrow(yield* files.size(input))).toBe(VOLUME_SIZE_BYTES);
                expect(yield* listCheckpoints(shared.admin)).toEqual([CHECKPOINT_ID]);
              }),
            );
          }).pipe(Effect.provide(Layer.merge(AgentState.Default, topology))),
        );
      }).pipe(Effect.timeout('4 minutes')),
    );
  },
  TEST_TIMEOUT_MS,
);
