import { expect, test } from 'bun:test';
import { AppIdSchema, VolumeIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Deferred, Effect, Fiber, Layer } from 'effect';
import { duringUnfencedReconciliation } from '#lib/reconcile/migration-fences.ts';
import { planReconcile } from '#lib/reconcile/plan.ts';
import { applyVolumes } from '#lib/reconcile/volumes.ts';
import { toReportedVolume } from '#lib/volumes/manager.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { ArtifactStore } from '#services/artifact-store.service.ts';
import { VolumeManager } from '#services/volume-manager.service.ts';
import { VolumeMigrationFences } from '#services/volume-migration-fences.service.ts';
import { recordingCommands } from '#tests/support/commands.ts';
import { agentConfig } from '#tests/support/config.ts';
import {
  APP_ID,
  desiredCheckpoint,
  desiredExport,
  desiredInstance,
  desiredState,
  desiredVolume,
  observedState,
  observedVolume,
} from '#tests/support/fixtures.ts';
import { platform, provided } from '#tests/support/run.ts';

const OTHER_APP = Value.Parse(AppIdSchema, 'other-app');
const OTHER_VOLUME = Value.Parse(VolumeIdSchema, 'other-volume');
const run = provided(
  Layer.mergeAll(
    AgentState.Default,
    VolumeMigrationFences.Default,
    platform,
    agentConfig(),
    recordingCommands().layer,
    Layer.succeed(
      ArtifactStore,
      ArtifactStore.make({ open: () => Effect.die('Fenced reports must not read artifacts.') }),
    ),
  ),
);
const desired = desiredState({
  instances: [desiredInstance(), desiredInstance({ appId: OTHER_APP, volumeId: OTHER_VOLUME })],
  volumes: [desiredVolume(), desiredVolume({ appId: OTHER_APP, volumeId: OTHER_VOLUME })],
  checkpoints: [desiredCheckpoint()],
  exports: [desiredExport()],
});
const observed = observedState();
const plan = planReconcile({ desired, observed });

test('a fenced source retains its last volume report while other volume reports update', () =>
  run(
    Effect.gen(function* () {
      const unavailable = observedVolume({ attached: false, sizeBytes: 0 });
      const other = observedVolume({ appId: OTHER_APP, volumeId: OTHER_VOLUME, sizeBytes: 8192 });
      const original = toReportedVolume(observedVolume());
      yield* AgentState.modify((current) => ({ ...current, volumeReports: [original] }));
      function apply(fencedApps: ReadonlySet<typeof APP_ID>) {
        return applyVolumes({
          plan: { instances: [], volumes: [], checkpoints: [], exports: [] },
          desired,
          observed: observedState({ volumes: [unavailable, other] }),
          fencedApps,
        }).pipe(
          Effect.provideService(
            VolumeManager,
            VolumeManager.make({
              observe: () => Effect.succeed([]),
              provision: () => Effect.die('Fenced volume work must not provision.'),
              teardown: () => Effect.die('Fenced volume work must not delete.'),
              reclaim: () => Effect.void,
            }),
          ),
        );
      }
      yield* apply(new Set([APP_ID]));
      expect((yield* AgentState.snapshot).volumeReports).toContainEqual(original);
      expect((yield* AgentState.snapshot).volumeReports).toContainEqual(toReportedVolume(other));
      yield* apply(new Set());
      expect((yield* AgentState.snapshot).volumeReports).toContainEqual(
        toReportedVolume(unavailable),
      );
    }),
  ));

test('a fenced app has no VM, volume, checkpoint or export actions while another app converges', () =>
  run(
    Effect.gen(function* () {
      const fences = yield* VolumeMigrationFences;
      yield* fences.during({
        appId: APP_ID,
        effect: duringUnfencedReconciliation({
          desired,
          observe: () => Effect.succeed(observed),
          use: (guarded) =>
            Effect.sync(() => {
              expect(guarded.blocked.has(APP_ID)).toBe(true);
              expect(guarded.plan.instances).toEqual([
                { action: 'start', desired: desired.instances[1]! },
              ]);
              expect(guarded.plan.volumes).toEqual([
                { action: 'provision', desired: desired.volumes[1]! },
              ]);
              expect(guarded.plan.checkpoints).toEqual([]);
              expect(guarded.plan.exports).toEqual([]);
            }),
        }),
      });
      yield* duringUnfencedReconciliation({
        desired,
        observe: () => Effect.succeed(observed),
        use: (guarded) => Effect.sync(() => expect(guarded.plan).toEqual(plan)),
      });
    }),
  ));

test('a migration waits for an admitted reconcile pass including its observation phase', () =>
  run(
    Effect.gen(function* () {
      const fences = yield* VolumeMigrationFences;
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      const pass = yield* duringUnfencedReconciliation({
        desired,
        observe: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as(observed),
          ),
        use: () => Effect.void,
      }).pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      const entered = yield* Deferred.make<void>();
      const held = yield* fences
        .during({ appId: APP_ID, effect: Deferred.succeed(entered, undefined) })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow();
      expect(yield* Deferred.isDone(entered)).toBe(false);
      yield* Deferred.succeed(finish, undefined);
      yield* Fiber.join(pass);
      yield* Fiber.join(held);
      expect(yield* Deferred.isDone(entered)).toBe(true);
    }),
  ));
