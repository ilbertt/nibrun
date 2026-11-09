import { expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import type { ReportedExport } from '@repo/protocol';
import { Deferred, Effect, Fiber, Layer } from 'effect';
import { makeNibrunnerExports, nibrunnerExportKey } from '#lib/nibrunner/exports.ts';
import { CommandRunner } from '#services/command-runner.service.ts';
import { artifactStore } from '#tests/support/artifacts.ts';
import {
  desiredExport,
  desiredState,
  desiredVolume,
  EXPORT_ID,
  OBSERVED_AT,
} from '#tests/support/fixtures.ts';
import { nibrunnerExportArchive } from '#tests/support/nibrunner.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(
  Layer.mergeAll(CommandRunner.Default.pipe(Layer.provideMerge(platform)), artifactStore()),
);
const PRIVATE_CAUSE = 'private credential and tenant content';

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* temporaryDirectory;
  const nativeArchive = nibrunnerExportArchive([
    { path: 'data/app/data/app.db', body: 'committed data' },
    { path: '.env', body: '' },
  ]);
  const nativePath = `${directory}/${nibrunnerExportKey(EXPORT_ID)}`;
  yield* fs.writeFile(nativePath, nativeArchive);
  const desired = desiredState({ exports: [desiredExport()], volumes: [desiredVolume()] });
  const native: ReportedExport = {
    exportId: EXPORT_ID,
    state: 'ready',
    sizeBytes: nativeArchive.length,
    readyAt: OBSERVED_AT,
  };
  const uploaded: Array<{ objectKey: string; size: number }> = [];
  const world: { sending: Effect.Effect<void, Error> } = { sending: Effect.void };
  const create = makeNibrunnerExports({
    directory,
    artifactBucket: 'binaries',
    upload: ({ bundlePath, objectKey }) =>
      Effect.gen(function* () {
        yield* world.sending;
        uploaded.push({ objectKey, size: Number((yield* fs.stat(bundlePath)).size) });
      }),
  });
  const publisher = yield* create;
  const input = { desired, reported: [native] };
  return { fs, directory, nativePath, desired, native, uploaded, world, create, publisher, input };
});

test('native ready stays preparing until the complete nibrun bundle is uploaded', async () => {
  await run(
    Effect.gen(function* () {
      const { publisher, world, input, uploaded, fs, nativePath } = yield* fixture;
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      world.sending = Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
      );
      const writing = yield* publisher.sync(input).pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      expect(
        (yield* publisher.reports({ desired: input.desired.exports, reported: input.reported }))[0]
          ?.state,
      ).toBe('preparing');
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(writing);
      const [report] = yield* publisher.reports({ desired: input.desired.exports, reported: [] });
      expect(report).toMatchObject({
        exportId: EXPORT_ID,
        state: 'ready',
        sizeBytes: uploaded[0]?.size,
      });
      expect(uploaded[0]?.objectKey).toBe(input.desired.exports[0]?.objectKey);
      expect(yield* fs.exists(nativePath)).toBe(true);
      yield* publisher.sync(input);
      expect(uploaded).toHaveLength(1);
    }),
  );
});

test('API acknowledgement reclaims the native archive and temporary work stays private and empty', async () => {
  await run(
    Effect.gen(function* () {
      const { publisher, input, fs, directory, nativePath } = yield* fixture;
      yield* publisher.sync(input);
      expect(yield* fs.readDirectory(`${directory}/bridge`)).toEqual([]);
      const acknowledged = desiredState({
        ...input.desired,
        exports: [desiredExport({ desiredState: 'absent' })],
      });
      yield* publisher.sync({ desired: acknowledged, reported: input.reported });
      expect(yield* fs.exists(nativePath)).toBe(false);
      expect(
        yield* publisher.reports({ desired: acknowledged.exports, reported: input.reported }),
      ).toEqual([]);
    }),
  );
});

test('a restart before acknowledgement can safely republish the retained native archive', async () => {
  await run(
    Effect.gen(function* () {
      const { publisher, create, input, uploaded, fs, directory } = yield* fixture;
      yield* publisher.sync(input);
      yield* fs.makeDirectory(`${directory}/bridge/interrupted`);
      yield* fs.writeFileString(`${directory}/bridge/interrupted/bundle.tar.gz`, 'incomplete');
      const restarted = yield* create;
      expect(yield* fs.readDirectory(`${directory}/bridge`)).toEqual([]);
      expect(
        (yield* restarted.reports({ desired: input.desired.exports, reported: input.reported }))[0]
          ?.state,
      ).toBe('preparing');
      yield* restarted.sync(input);
      expect(uploaded).toHaveLength(2);
      expect(uploaded[1]?.objectKey).toBe(uploaded[0]?.objectKey);
      expect(
        (yield* restarted.reports({ desired: input.desired.exports, reported: input.reported }))[0]
          ?.state,
      ).toBe('ready');
    }),
  );
});

test('failed uploads stay failed without leaking the cause or discarding retry input', async () => {
  await run(
    Effect.gen(function* () {
      const { publisher, world, input, uploaded, fs, nativePath, directory } = yield* fixture;
      world.sending = Effect.fail(new Error(PRIVATE_CAUSE));
      yield* publisher.sync(input);
      const reports = yield* publisher.reports({
        desired: input.desired.exports,
        reported: input.reported,
      });
      expect(reports[0]?.state).toBe('failed');
      expect(JSON.stringify(reports)).not.toContain(PRIVATE_CAUSE);
      expect(uploaded).toEqual([]);
      expect(yield* fs.exists(nativePath)).toBe(true);
      expect(yield* fs.readDirectory(`${directory}/bridge`)).toEqual([]);
    }),
  );
});

test('interrupted uploads preserve input and can be retried without reporting ready', async () => {
  await run(
    Effect.gen(function* () {
      const { publisher, world, input, fs, nativePath } = yield* fixture;
      const started = yield* Deferred.make<void>();
      world.sending = Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never));
      const writing = yield* publisher.sync(input).pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(writing);
      expect(
        (yield* publisher.reports({ desired: input.desired.exports, reported: input.reported }))[0]
          ?.state,
      ).toBe('preparing');
      expect(yield* fs.exists(nativePath)).toBe(true);
      world.sending = Effect.void;
      yield* publisher.sync(input);
      expect(
        (yield* publisher.reports({ desired: input.desired.exports, reported: input.reported }))[0]
          ?.state,
      ).toBe('ready');
    }),
  );
});
