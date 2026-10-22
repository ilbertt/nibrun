import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { FileSystem } from '@effect/platform';
import { Effect, Layer, Option } from 'effect';
import { FILESYSTEM_LABEL, format } from '#lib/volumes/ext4.ts';
import { isAttached } from '#lib/volumes/nbd.ts';
import { flush } from '#lib/volumes/zerofs.ts';
import { AppVolumeFiles } from '#services/app-volume-files.service.ts';
import { AppVolumeNbd } from '#services/app-volume-nbd.service.ts';
import { CommandRunner, stdoutOf } from '#services/command-runner.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import { VOLUME_ID, VOLUME_SIZE_BYTES } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { s3Backend } from '#tests/support/s3-backend.ts';
import { configuredZerofs } from '#tests/support/zerofs.ts';

const TEST_TIMEOUT_MS = 300_000;
const PAYLOAD = 'customer data survives a ZeroFS restart without its local cache';
const NBD_DEVICE = '/dev/nbd0';
const EXT4_SIZE_BYTES = 67_108_864;
const FILE_OWNER = { uid: 12345, gid: 12346 };
const FILE_MODE = 0o640;
const DIRECTORY_MODE = 0o755;
const run = provided(
  Layer.mergeAll(
    CommandRunner.Default,
    AppVolumeFiles.Default,
    AppVolumeNbd.DefaultWithoutDependencies.pipe(Layer.provide(agentConfig())),
  ).pipe(Layer.provideMerge(platform)),
);

function attachedVolume<A, E, R>({
  target,
  effect,
}: {
  target: Parameters<AppVolumeNbd['reattach']>[0];
  effect: Effect.Effect<A, E, R>;
}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const nbd = yield* AppVolumeNbd;
      if (
        (yield* fs.stat(target.devicePath)).type !== 'BlockDevice' ||
        (yield* isAttached(target.devicePath))
      ) {
        return yield* Effect.fail(
          new Error('The ZeroFS fixture requires an unused NBD block device.'),
        );
      }
      yield* Effect.addFinalizer(() => nbd.detach(target).pipe(Effect.orDie));
      yield* nbd.reattach(target);
      return yield* effect;
    }),
  );
}

function mountedExt4<A, E, R>({
  devicePath,
  use,
}: {
  devicePath: string;
  use: (mountPath: string) => Effect.Effect<A, E, R>;
}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* temporaryDirectory;
      yield* fs.chmod(directory, DIRECTORY_MODE);
      const mountPath = join(directory, 'data');
      yield* fs.makeDirectory(mountPath);
      yield* Effect.acquireRelease(
        stdoutOf({
          command: ['mount', '-t', 'ext4', '-o', 'rw,nodev,nosuid,noexec', devicePath, mountPath],
        }),
        () => stdoutOf({ command: ['umount', '--', mountPath] }).pipe(Effect.orDie),
      );
      return yield* use(mountPath);
    }),
  );
}

function seededDirectory() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* temporaryDirectory;
    yield* fs.chmod(directory, DIRECTORY_MODE);
    const records = join(directory, 'records');
    const note = join(records, 'note');
    yield* fs.makeDirectory(records, { mode: 0o750 });
    yield* fs.writeFileString(note, PAYLOAD);
    yield* fs.chmod(note, FILE_MODE);
    for (const path of [records, note]) {
      yield* fs.chown(path, FILE_OWNER.uid, FILE_OWNER.gid);
    }
    return directory;
  });
}

function appendAsOwner(path: string) {
  return stdoutOf({
    command: [
      'setpriv',
      '--reuid',
      String(FILE_OWNER.uid),
      '--regid',
      String(FILE_OWNER.gid),
      '--clear-groups',
      '--',
      'tee',
      '--append',
      path,
    ],
    stdin: PAYLOAD,
  });
}

test.skipIf(process.platform !== 'linux' || process.env.NIBRUN_TEST_ZEROFS !== '1')(
  'configured ZeroFS restores NBD writes from S3 after a restart with no local cache',
  async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const files = yield* AppVolumeFiles;
        const backend = yield* s3Backend();
        const host = yield* configuredZerofs(backend);
        const input = { mountPath: host.paths.mountPath, volumeId: VOLUME_ID };
        const directory = yield* temporaryDirectory;
        const original = join(directory, 'original');
        const recovered = join(directory, 'recovered');
        const payload = new Uint8Array(VOLUME_SIZE_BYTES);
        payload.set(new TextEncoder().encode(PAYLOAD));
        yield* fs.writeFile(original, payload);
        const target = {
          socketPath: host.paths.sockets.nbd,
          devicePath: NBD_DEVICE,
          volumeId: VOLUME_ID,
        };
        yield* host.run(
          Effect.gen(function* () {
            expect(Option.isNone(yield* files.size(input))).toBe(true);
            expect(yield* files.ensure({ ...input, sizeBytes: VOLUME_SIZE_BYTES })).toBe(
              VOLUME_SIZE_BYTES,
            );
            yield* attachedVolume({
              target,
              effect: Effect.gen(function* () {
                yield* stdoutOf({
                  command: [
                    'dd',
                    `if=${original}`,
                    `of=${target.devicePath}`,
                    `bs=${VOLUME_SIZE_BYTES}`,
                    'count=1',
                    'oflag=direct',
                    'conv=fsync',
                    'status=none',
                  ],
                });
                yield* flush(host.admin);
                expect(yield* backend.list).toContain('<Key>');
              }),
            });
          }),
        );
        yield* host.clearCache;
        yield* host.run(
          Effect.gen(function* () {
            expect(Option.getOrThrow(yield* files.size(input))).toBe(VOLUME_SIZE_BYTES);
            yield* attachedVolume({
              target,
              effect: Effect.gen(function* () {
                yield* stdoutOf({
                  command: [
                    'dd',
                    `if=${target.devicePath}`,
                    `of=${recovered}`,
                    `bs=${VOLUME_SIZE_BYTES}`,
                    'count=1',
                    'iflag=direct',
                    'status=none',
                  ],
                });
                expect(Buffer.from(yield* fs.readFile(recovered))).toEqual(Buffer.from(payload));
              }),
            });
          }),
        );
      }).pipe(Effect.timeout('4 minutes')),
    );
  },
  TEST_TIMEOUT_MS,
);

test.skipIf(process.platform !== 'linux' || process.env.NIBRUN_TEST_ZEROFS !== '1')(
  'configured ZeroFS restores a writable seeded ext4 filesystem from S3 without its local cache',
  async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const files = yield* AppVolumeFiles;
        const backend = yield* s3Backend();
        const host = yield* configuredZerofs(backend);
        const seedDir = Option.some(yield* seededDirectory());
        const input = { mountPath: host.paths.mountPath, volumeId: VOLUME_ID };
        const target = {
          socketPath: host.paths.sockets.nbd,
          devicePath: NBD_DEVICE,
          volumeId: VOLUME_ID,
        };
        const formatting = { devicePath: target.devicePath, seedDir };
        yield* host.run(
          Effect.gen(function* () {
            yield* files.ensure({ ...input, sizeBytes: EXT4_SIZE_BYTES });
            yield* attachedVolume({
              target,
              effect: Effect.gen(function* () {
                expect(yield* format(formatting)).toBe(true);
                yield* mountedExt4({
                  devicePath: target.devicePath,
                  use: (mountPath) =>
                    Effect.gen(function* () {
                      const note = join(mountPath, 'records', 'note');
                      expect(yield* fs.readFileString(note)).toBe(PAYLOAD);
                      yield* appendAsOwner(note);
                    }),
                });
                yield* flush(host.admin);
              }),
            });
          }),
        );
        yield* host.clearCache;
        yield* host.run(
          Effect.gen(function* () {
            expect(Option.getOrThrow(yield* files.size(input))).toBe(EXT4_SIZE_BYTES);
            yield* attachedVolume({
              target,
              effect: Effect.gen(function* () {
                expect(yield* format(formatting)).toBe(false);
                yield* stdoutOf({ command: ['e2fsck', '-f', '-n', target.devicePath] });
                expect(
                  (yield* stdoutOf({
                    command: ['blkid', '-s', 'LABEL', '-o', 'value', target.devicePath],
                  })).trim(),
                ).toBe(FILESYSTEM_LABEL);
                yield* mountedExt4({
                  devicePath: target.devicePath,
                  use: (mountPath) =>
                    Effect.gen(function* () {
                      const note = join(mountPath, 'records', 'note');
                      expect(yield* fs.readFileString(note)).toBe(PAYLOAD + PAYLOAD);
                      const stat = yield* fs.stat(note);
                      expect({
                        uid: Option.getOrThrow(stat.uid),
                        gid: Option.getOrThrow(stat.gid),
                      }).toEqual(FILE_OWNER);
                      expect(stat.mode & 0o777).toBe(FILE_MODE);
                      yield* appendAsOwner(note);
                      expect(yield* fs.readFileString(note)).toBe(PAYLOAD + PAYLOAD + PAYLOAD);
                    }),
                });
                yield* flush(host.admin);
              }),
            });
          }),
        );
      }).pipe(Effect.timeout('4 minutes')),
    );
  },
  TEST_TIMEOUT_MS,
);
