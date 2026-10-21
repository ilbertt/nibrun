import { expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { Command, FileSystem } from '@effect/platform';
import { VolumeIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Either, Layer, Schedule } from 'effect';
import {
  attachmentLock,
  attachmentScope,
  detachVerified,
  inspectAttachment,
  isAttached,
  isUsableFor,
  NBD_CLIENT,
  reattachVerified,
} from '#lib/volumes/nbd.ts';
import { CommandRunner, run as runCommand, stdoutOf } from '#services/command-runner.service.ts';
import { VOLUME_ID } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const commands = Layer.effect(
  CommandRunner,
  Effect.map(CommandRunner, (runner) =>
    CommandRunner.make({
      run: (request) =>
        runner.run({
          ...request,
          command: ['sudo', '--non-interactive', '--', ...request.command],
        }),
    }),
  ),
).pipe(Layer.provide(CommandRunner.Default));
const run = provided(commands.pipe(Layer.provideMerge(platform)));
const TEST_TIMEOUT_MS = 30_000;

test.skipIf(process.platform !== 'linux' || process.env.NIBRUN_TEST_NBD !== '1')(
  'the packaged NBD client proves its real kernel attachment and rejects another export',
  async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* temporaryDirectory;
        const target = {
          socketPath: join(directory, 'nbd.sock'),
          devicePath: '/dev/nbd0',
          volumeId: VOLUME_ID,
          client: NBD_CLIENT,
        };
        expect(yield* isAttached(target.devicePath)).toBe(false);
        yield* stdoutOf({
          command: [
            'install',
            '--directory',
            '--mode=0700',
            `--owner=${process.getuid?.()}`,
            dirname(attachmentLock(target)),
          ],
        });
        yield* Command.start(
          Command.make('nbdkit', '--foreground', '--unix', target.socketPath, 'memory', '16M'),
        );
        const poll = Schedule.spaced('50 millis').pipe(Schedule.upTo('3 seconds'));
        yield* fs.exists(target.socketPath).pipe(
          Effect.filterOrFail(
            (ready) => ready,
            () => new Error('NBD fixture did not start.'),
          ),
          Effect.retry(poll),
        );
        yield* Effect.addFinalizer(() =>
          runCommand({
            command: ['systemctl', 'stop', attachmentScope(target)],
          }).pipe(Effect.ignore),
        );

        yield* reattachVerified(target);
        expect(yield* inspectAttachment(target)).toBe(true);
        expect(
          (yield* runCommand({ command: ['flock', '--nonblock', attachmentLock(target), 'true'] }))
            .code,
        ).toBe(1);
        expect(yield* isUsableFor(target)).toBe(true);
        const wrong = { ...target, volumeId: Value.Parse(VolumeIdSchema, 'another-volume') };
        const rejected = yield* Effect.either(detachVerified(wrong));
        expect(Either.isLeft(rejected) && rejected.left._tag).toBe('NbdAttachmentMismatch');
        expect(yield* isUsableFor(target)).toBe(true);

        yield* reattachVerified(target).pipe(Effect.retry(poll));
        expect(yield* isUsableFor(target)).toBe(true);
        yield* detachVerified(target);
        expect(
          (yield* runCommand({ command: ['flock', '--nonblock', attachmentLock(target), 'true'] }))
            .code,
        ).toBe(0);
        yield* isAttached(target.devicePath).pipe(
          Effect.filterOrFail(
            (attached) => !attached,
            () => new Error('NBD fixture did not detach.'),
          ),
          Effect.retry(poll),
        );
      }),
    );
  },
  TEST_TIMEOUT_MS,
);
