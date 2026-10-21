import { describe, expect, test } from 'bun:test';
import { Effect, Either, Option } from 'effect';
import { readAppZerofsCacheMemoryBytes } from '#lib/volumes/app-zerofs-cache.ts';
import { readAppZerofsRetirement } from '#lib/volumes/app-zerofs-retirement.ts';
import { AppZerofs } from '#services/app-zerofs.service.ts';
import { appZerofsLifecycleHost } from '#tests/support/app-zerofs-lifecycle.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { platform, provided } from '#tests/support/run.ts';

const run = provided(platform);

describe('acknowledged per-app ZeroFS file reclamation', () => {
  test('hosts without retirement records perform no cleanup or service commands', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* appZerofsLifecycleHost();
        yield* Effect.flatMap(AppZerofs, (app) => app.reclaim(new Set())).pipe(
          Effect.provide(host.layer),
        );
        expect(host.commands.commands).toEqual([]);
        expect(host.persisted.get(host.paths.configFile)).toBe(host.contents);
        expect(host.events).toEqual([]);
      }),
    );
  });

  test('reclamation waits for acknowledgement and releases only the retired cache reservation', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* appZerofsLifecycleHost();
        yield* Effect.gen(function* () {
          const app = yield* AppZerofs;
          yield* app.retire(host.desired);
          const before = yield* readAppZerofsCacheMemoryBytes('/var/lib/nibrun');
          expect(before).toBeGreaterThan(0);
          host.commands.commands.length = 0;
          yield* app.reclaim(new Set([APP_ID]));
          expect(host.commands.commands).toEqual([]);
          expect(host.persisted.get(host.paths.configFile)).toBe(host.contents);
          yield* app.reclaim(new Set());
          expect(host.persisted.has(host.paths.configFile)).toBe(false);
          expect(
            [...host.persisted.keys()].some((name) => name.startsWith(host.paths.cacheDirectory)),
          ).toBe(false);
          expect(yield* readAppZerofsCacheMemoryBytes('/var/lib/nibrun')).toBe(0);
          const receipt = yield* readAppZerofsRetirement(APP_ID);
          expect(Option.isSome(receipt) && receipt.value.cleaned).toBe(true);
          expect(
            host.commands.commands.some(({ command }) =>
              ['start', 'stop', 'flush'].includes(command[1] ?? ''),
            ),
          ).toBe(false);
          const length = host.commands.commands.length;
          yield* app.reclaim(new Set());
          expect(host.commands.commands).toHaveLength(length);
        }).pipe(Effect.provide(host.layer));
      }),
    );
  });

  test.each(['cache-remove', 'config-remove', 'data-mount', 'receipt', 'sync'] as const)(
    'a failure at %s can resume without reopening the bucket',
    async (fault) => {
      await run(
        Effect.gen(function* () {
          const host = yield* appZerofsLifecycleHost();
          yield* Effect.flatMap(AppZerofs, (app) => app.retire(host.desired)).pipe(
            Effect.provide(host.layer),
          );
          host.commands.commands.length = 0;
          host.faults.add(fault);
          const failed = yield* Effect.flatMap(AppZerofs, (app) => app.reclaim(new Set())).pipe(
            Effect.either,
            Effect.provide(host.layer),
          );
          expect(Either.isLeft(failed) && failed.left._tag).toBe('AppZerofsRetirementUnavailable');
          expect(host.persisted.has(host.receipt)).toBe(true);
          host.faults.clear();
          yield* Effect.flatMap(AppZerofs, (app) => app.reclaim(new Set())).pipe(
            Effect.provide(host.layer),
          );
          expect(host.persisted.has(host.paths.configFile)).toBe(false);
          expect(
            host.commands.commands.some(({ command }) =>
              ['start', 'stop', 'flush'].includes(command[1] ?? ''),
            ),
          ).toBe(false);
        }),
      );
    },
  );

  test.each(['running', 'changed-config'] as const)(
    'unexpected state %s preserves the local files',
    async (fault) => {
      await run(
        Effect.gen(function* () {
          const host = yield* appZerofsLifecycleHost();
          yield* Effect.flatMap(AppZerofs, (app) => app.retire(host.desired)).pipe(
            Effect.provide(host.layer),
          );
          if (fault === 'running') {
            host.state.running = true;
          } else {
            host.persisted.set(host.paths.configFile, 'a different backend');
          }
          const failed = yield* Effect.flatMap(AppZerofs, (app) => app.reclaim(new Set())).pipe(
            Effect.either,
            Effect.provide(host.layer),
          );
          expect(Either.isLeft(failed)).toBe(true);
          expect(host.persisted.has(host.paths.configFile)).toBe(true);
          expect(host.events).not.toContain('cache-remove');
          expect(host.events).not.toContain('config-remove');
        }),
      );
    },
  );
});
