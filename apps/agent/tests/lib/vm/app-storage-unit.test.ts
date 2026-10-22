import { describe, expect, test } from 'bun:test';
import { Effect, Either } from 'effect';
import { isolateAppVmStorage, VM_TEMPLATE_UNIT_FILE } from '#lib/vm/app-storage-unit.ts';
import { appZerofsUnits } from '#lib/volumes/app-zerofs-systemd.ts';
import { appVmUnitHost } from '#tests/support/app-vm-unit.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { platform, provided } from '#tests/support/run.ts';

const run = provided(platform);

describe('configured VM storage dependencies', () => {
  test('keeps the installed service body and changes only its storage dependencies', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* appVmUnitHost();
        yield* isolateAppVmStorage(APP_ID).pipe(Effect.provide(host.layer));
        const rendered = host.files.get(host.unitFile) ?? '';
        expect(rendered.split('[Service]')[1]).toBe(host.template.split('[Service]')[1]);
        expect(rendered).toContain(`BindsTo=${appZerofsUnits(APP_ID).server}\n`);
        expect(rendered).toContain(`After=${appZerofsUnits(APP_ID).server}\n`);
        expect(rendered).not.toContain('nibrun-zerofs.service');
        expect(host.files.get(VM_TEMPLATE_UNIT_FILE)).toBe(host.template);
        expect(host.commands.commands.map(({ command }) => command[1])).toEqual([
          'daemon-reload',
          'show',
        ]);
        host.commands.commands.length = 0;
        yield* isolateAppVmStorage(APP_ID).pipe(Effect.provide(host.layer));
        expect(host.commands.commands.map(({ command }) => command[1])).toEqual(['show']);
      }),
    );
  });

  test('retries a failed reload even when the complete runtime file already exists', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* appVmUnitHost();
        host.state.failReload = true;
        const failed = yield* isolateAppVmStorage(APP_ID).pipe(
          Effect.either,
          Effect.provide(host.layer),
        );
        expect(Either.isLeft(failed) && failed.left._tag).toBe('VmStorageUnitUnavailable');
        expect(JSON.stringify(failed)).not.toContain('private-unit-details');
        expect(host.files.has(host.unitFile)).toBe(true);
        host.state.failReload = false;
        host.commands.commands.length = 0;
        yield* isolateAppVmStorage(APP_ID).pipe(Effect.provide(host.layer));
        expect(host.commands.commands.map(({ command }) => command[1])).toEqual([
          'show',
          'daemon-reload',
          'show',
        ]);
      }),
    );
  });

  test.each(['wrongDependency', 'wrongFragment', 'readOnly'] as const)(
    'refuses to start through an unverified runtime unit: %s',
    async (fault) => {
      await run(
        Effect.gen(function* () {
          const host = yield* appVmUnitHost();
          host.state[fault] = true;
          const result = yield* isolateAppVmStorage(APP_ID).pipe(
            Effect.either,
            Effect.provide(host.layer),
          );
          expect(Either.isLeft(result) && result.left._tag).toBe('VmStorageUnitUnavailable');
          expect(JSON.stringify(result)).not.toContain('private-unit-details');
          expect(host.commands.commands.every(({ command }) => command[1] !== 'start')).toBe(true);
        }),
      );
    },
  );

  test('an incompatible installed template never publishes a replacement', async () => {
    await run(
      Effect.gen(function* () {
        const host = yield* appVmUnitHost();
        host.files.set(
          VM_TEMPLATE_UNIT_FILE,
          host.template.replace('After=nibrun-zerofs.service', 'After=another.service'),
        );
        const result = yield* isolateAppVmStorage(APP_ID).pipe(
          Effect.either,
          Effect.provide(host.layer),
        );
        expect(Either.isLeft(result)).toBe(true);
        expect(host.files.has(host.unitFile)).toBe(false);
        expect(host.commands.commands).toEqual([]);
      }),
    );
  });
});
