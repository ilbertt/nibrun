import { describe, expect, test } from 'bun:test';
import { dirname } from 'node:path';
import { Effect, Either, Option } from 'effect';
import { appZerofsFilesystem } from '#lib/volumes/app-zerofs-filesystem.ts';
import { selectVolumeFilesystem } from '#lib/volumes/placement.ts';
import { AppZerofs } from '#services/app-zerofs.service.ts';
import { VolumeMigrationFences } from '#services/volume-migration-fences.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { appZerofsLifecycleHost } from '#tests/support/app-zerofs-lifecycle.ts';
import { APP_ID, VOLUME_SIZE_BYTES } from '#tests/support/fixtures.ts';
import { platform, provided } from '#tests/support/run.ts';
import { s3Storage } from '#tests/support/s3-storage.ts';

const run = provided(platform);

function migrationHost() {
  return Effect.gen(function* () {
    const host = yield* appZerofsLifecycleHost();
    host.state.attached = false;
    host.source.size = VOLUME_SIZE_BYTES;
    return { ...host, desired: { ...host.desired, desiredState: 'present' as const } };
  });
}

function abort(host: Effect.Effect.Success<ReturnType<typeof migrationHost>>) {
  return Effect.gen(function* () {
    const app = yield* AppZerofs;
    return yield* (yield* VolumeMigrationFences).during({
      appId: APP_ID,
      effect: app.abortMigration(host.desired),
    });
  });
}

describe('aborting a migration destination before cutover', () => {
  test('removes only local destination staging, restores shared placement and allows retries', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* migrationHost();
        yield* Effect.gen(function* () {
          const app = yield* AppZerofs;
          const topology = yield* ZerofsTopology;
          const fences = yield* VolumeMigrationFences;
          yield* fences.during({
            appId: APP_ID,
            effect: app.prepareMigration(host.desired),
          });
          const source = { ...host.desired, storage: undefined };
          expect(yield* Effect.isFailure(selectVolumeFilesystem(source))).toBe(true);
          host.events.length = 0;
          yield* abort(host);
          expect(host.events).toEqual(['stop', 'cache-remove', 'sync', 'config-remove', 'sync']);
          expect(host.state).toEqual({
            attached: false,
            allocated: true,
            image: true,
            running: false,
            mounted: false,
          });
          expect(host.source.size).toBe(VOLUME_SIZE_BYTES);
          expect(host.persisted.size).toBe(0);
          expect(Option.isNone(yield* topology.lookupAppFilesystem(APP_ID))).toBe(true);
          expect(yield* selectVolumeFilesystem(source)).toEqual(topology.place());
          yield* abort(host);
        }).pipe(Effect.provide(host.layer));
        yield* abort(host).pipe(Effect.provide(host.layer));
        expect(host.events).not.toContain('release');
        expect(host.events).not.toContain('detach');
        expect(host.events).not.toContain('remove');
      }),
    );
  });

  test('requires an explicit destination and the drained lifecycle fence', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* migrationHost();
        yield* Effect.gen(function* () {
          const app = yield* AppZerofs;
          for (const desired of [
            host.desired,
            { ...host.desired, storage: undefined },
            { ...host.desired, desiredState: 'absent' as const },
          ]) {
            expect(yield* Effect.isFailure(app.abortMigration(desired))).toBe(true);
          }
        }).pipe(Effect.provide(host.layer));
        expect(host.commands.commands).toEqual([]);
        expect(host.persisted.get(host.paths.configFile)).toBe(host.contents);
      }),
    );
  });

  test.each([undefined, 0, VOLUME_SIZE_BYTES - 1, VOLUME_SIZE_BYTES * 2])(
    'does not stop or delete anything when the shared source size is %s',
    async (size) => {
      await run(
        Effect.gen(function* () {
          const host = yield* migrationHost();
          host.source.size = size;
          expect(yield* Effect.isFailure(abort(host)).pipe(Effect.provide(host.layer))).toBe(true);
          expect(host.commands.commands).toEqual([]);
          expect(host.persisted.get(host.paths.configFile)).toBe(host.contents);
        }),
      );
    },
  );

  test('refuses cleanup while the assigned device still has a client', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* migrationHost();
        host.state.attached = true;
        expect(yield* Effect.isFailure(abort(host)).pipe(Effect.provide(host.layer))).toBe(true);
        expect(host.commands.commands).toEqual([]);
        host.state.attached = false;
        yield* abort(host).pipe(Effect.provide(host.layer));
        expect(host.state.allocated).toBe(true);
      }),
    );
  });

  test('a different staged config or registered backend is never stopped', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* migrationHost();
        host.persisted.set(host.paths.configFile, 'a different customer config');
        expect(yield* Effect.isFailure(abort(host)).pipe(Effect.provide(host.layer))).toBe(true);
        host.persisted.set(host.paths.configFile, host.contents);
        yield* Effect.gen(function* () {
          const storage = s3Storage({ prefix: 'another-attempt' });
          const filesystem = yield* appZerofsFilesystem({
            appId: APP_ID,
            storagePrefix: storage.prefix,
          });
          yield* (yield* ZerofsTopology).registerAppFilesystem({
            appId: APP_ID,
            storage,
            filesystem,
          });
          expect(yield* Effect.isFailure(abort(host))).toBe(true);
        }).pipe(Effect.provide(host.layer));
        expect(host.commands.commands).toEqual([]);
        expect(host.events).toEqual([]);
      }),
    );
  });

  test('a retirement marker or missing config with leftover staging refuses cleanup', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* migrationHost();
        host.persisted.set(host.receipt, '{}');
        expect(yield* Effect.isFailure(abort(host)).pipe(Effect.provide(host.layer))).toBe(true);
        host.persisted.delete(host.receipt);
        host.persisted.delete(host.paths.configFile);
        expect(yield* Effect.isFailure(abort(host)).pipe(Effect.provide(host.layer))).toBe(true);
        host.persisted.clear();
        host.persisted.set(`${dirname(host.paths.configFile)}/unknown`, 'unidentified staging');
        expect(yield* Effect.isFailure(abort(host)).pipe(Effect.provide(host.layer))).toBe(true);
        expect(host.events).toEqual([]);
      }),
    );
  });

  test.each([
    'stop',
    'still-running',
    'data-mount',
    'cache-remove',
    'config-remove',
    'device-state',
    'sync',
    'config-sync',
  ] as const)(
    'a failure at %s preserves the source and can be retried after an agent restart',
    async (fault) => {
      await run(
        Effect.gen(function* () {
          const host = yield* migrationHost();
          host.faults.add(fault);
          const result = yield* abort(host).pipe(Effect.either, Effect.provide(host.layer));
          expect(Either.isLeft(result) && result.left._tag).toBe('VolumeMigrationAbortFailed');
          expect(JSON.stringify(result)).not.toContain('customer-secret-key');
          expect(host.state.allocated).toBe(true);
          expect(host.state.image).toBe(true);
          expect(host.source.size).toBe(VOLUME_SIZE_BYTES);
          expect(host.persisted.has(host.receipt)).toBe(false);
          if (fault !== 'config-sync') {
            expect(host.persisted.get(host.paths.configFile)).toBe(host.contents);
          }
          host.faults.clear();
          yield* abort(host).pipe(Effect.provide(host.layer));
          expect(host.persisted.size).toBe(0);
          expect(host.state.running).toBe(false);
          expect(host.state.allocated).toBe(true);
        }),
      );
    },
  );
});
