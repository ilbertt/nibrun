import { describe, expect, test } from 'bun:test';
import { Effect, Either, Option } from 'effect';
import { appZerofsUnits } from '#lib/volumes/app-zerofs-systemd.ts';
import { selectVolumeFilesystem } from '#lib/volumes/placement.ts';
import { AppZerofs } from '#services/app-zerofs.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { appZerofsLifecycleHost } from '#tests/support/app-zerofs-lifecycle.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { platform, provided } from '#tests/support/run.ts';
import { s3Storage } from '#tests/support/s3-storage.ts';

const run = provided(platform);

describe('explicit per-app ZeroFS retirement', () => {
  test('durably deletes the image and stops both services before releasing ownership', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* appZerofsLifecycleHost();
        yield* Effect.gen(function* () {
          const app = yield* AppZerofs;
          const report = yield* app.retire(host.desired);
          expect(report.state).toBe('deleted');
          expect(host.events).toEqual([
            'start',
            'flush-data',
            'detach',
            'remove',
            'flush-deletion',
            'stop',
            'receipt',
            'sync',
            'sync',
            'sync',
            'release',
          ]);
          expect(host.state).toEqual({
            attached: false,
            allocated: false,
            image: false,
            running: false,
            mounted: false,
          });
          expect(host.persisted.get(host.paths.configFile)).toBe(host.contents);
          expect(host.persisted.has(host.receipt)).toBe(true);
          expect(Option.isNone(yield* (yield* ZerofsTopology).lookupAppFilesystem(APP_ID))).toBe(
            true,
          );
          const before = host.commands.commands.length;
          yield* (yield* ZerofsTopology).flushAll;
          expect(host.commands.commands.slice(before).map(({ command }) => command.at(-1))).toEqual(
            ['/etc/zerofs/config.toml'],
          );
          const units = appZerofsUnits(APP_ID);
          expect(
            host.commands.commands.find(({ command }) => command[1] === 'stop')?.command,
          ).toEqual(['systemctl', 'stop', units.mount, units.server]);
        }).pipe(Effect.provide(host.layer));
      }),
    );
  });

  test.each(['flush-data', 'flush-deletion', 'stop', 'receipt', 'still-running'] as const)(
    'a failure at %s cannot report retirement or release the slot and can be retried',
    async (fault) => {
      await run(
        Effect.gen(function* () {
          const host = yield* appZerofsLifecycleHost();
          host.faults.add(fault);
          const failed = yield* Effect.flatMap(AppZerofs, (app) => app.retire(host.desired)).pipe(
            Effect.either,
            Effect.provide(host.layer),
          );
          expect(Either.isLeft(failed)).toBe(true);
          expect(JSON.stringify(failed)).not.toContain('customer-secret-key');
          expect(host.persisted.has(host.receipt)).toBe(false);
          expect(host.persisted.get(host.paths.configFile)).toBe(host.contents);
          expect(host.state.allocated).toBe(true);
          if (fault === 'flush-data' || fault === 'flush-deletion') {
            expect(host.events).not.toContain('stop');
          }
          host.faults.clear();
          const report = yield* Effect.flatMap(AppZerofs, (app) => app.retire(host.desired)).pipe(
            Effect.provide(host.layer),
          );
          expect(report.state).toBe('deleted');
          expect(host.state.running).toBe(false);
          expect(host.state.allocated).toBe(false);
        }),
      );
    },
  );

  test('an agent restart after retirement reports deletion without reopening storage', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* appZerofsLifecycleHost();
        yield* Effect.flatMap(AppZerofs, (app) => app.retire(host.desired)).pipe(
          Effect.provide(host.layer),
        );
        host.commands.commands.length = 0;
        const report = yield* Effect.flatMap(AppZerofs, (app) => app.retire(host.desired)).pipe(
          Effect.provide(host.layer),
        );
        expect(report.state).toBe('deleted');
        expect(host.commands.commands).toEqual([]);
        const present = { ...host.desired, desiredState: 'present' as const };
        const restarted = yield* Effect.flatMap(AppZerofs, (app) => app.ensure(present)).pipe(
          Effect.either,
          Effect.provide(host.layer),
        );
        expect(Either.isLeft(restarted) && restarted.left._tag).toBe('AppVolumeUnavailable');
        const shared = yield* selectVolumeFilesystem({ ...present, storage: undefined }).pipe(
          Effect.either,
          Effect.provide(host.layer),
        );
        expect(Either.isLeft(shared) && shared.left._tag).toBe('VolumeStorageConflict');
        expect(host.commands.commands).toEqual([]);
      }),
    );
  });

  test('a retirement record must reach disk before deletion is reported', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* appZerofsLifecycleHost();
        host.faults.add('sync');
        const result = yield* Effect.flatMap(AppZerofs, (app) => app.retire(host.desired)).pipe(
          Effect.either,
          Effect.provide(host.layer),
        );
        expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsRetirementUnavailable');
        expect(host.persisted.has(host.receipt)).toBe(true);
        expect(host.state.allocated).toBe(true);
        expect(host.state.running).toBe(false);
        host.faults.clear();
        host.commands.commands.length = 0;
        const report = yield* Effect.flatMap(AppZerofs, (app) => app.retire(host.desired)).pipe(
          Effect.provide(host.layer),
        );
        expect(report.state).toBe('deleted');
        expect(host.commands.commands).toEqual([]);
      }),
    );
  });

  test('an absent or conflicting configuration is never created or replaced during deletion', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* appZerofsLifecycleHost();
        host.persisted.delete(host.paths.configFile);
        const missing = yield* Effect.flatMap(AppZerofs, (app) => app.retire(host.desired)).pipe(
          Effect.either,
          Effect.provide(host.layer),
        );
        expect(Either.isLeft(missing) && missing.left._tag).toBe('AppZerofsConfigUnavailable');
        host.persisted.set(host.paths.configFile, 'another configuration');
        const different = yield* Effect.flatMap(AppZerofs, (app) => app.retire(host.desired)).pipe(
          Effect.either,
          Effect.provide(host.layer),
        );
        expect(Either.isLeft(different) && different.left._tag).toBe('AppZerofsConfigConflict');
        expect(host.commands.commands).toEqual([]);
        expect(host.state.image).toBe(true);
      }),
    );
  });

  test('a retirement record cannot authorize another backend or a present volume', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* appZerofsLifecycleHost();
        yield* Effect.flatMap(AppZerofs, (app) => app.retire(host.desired)).pipe(
          Effect.provide(host.layer),
        );
        host.commands.commands.length = 0;
        for (const wanted of [
          { ...host.desired, storage: s3Storage({ bucket: 'another-bucket' }) },
          { ...host.desired, desiredState: 'present' as const },
        ]) {
          const refused = yield* Effect.flatMap(AppZerofs, (app) => app.retire(wanted)).pipe(
            Effect.either,
            Effect.provide(host.layer),
          );
          expect(Either.isLeft(refused)).toBe(true);
        }
        expect(host.commands.commands).toEqual([]);
      }),
    );
  });
});
