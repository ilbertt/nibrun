import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { FileSystem } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import { type AppId, AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Either } from 'effect';
import {
  guestMemoryMib,
  readGuestMemoryMib,
  readHostCapacity,
  readHostMemoryMib,
} from '#lib/report/capacity.ts';
import { refusalForDisk } from '#lib/vm/snapshot.ts';
import {
  readAppZerofsCacheDiskBytes,
  readAppZerofsCacheMemoryBytes,
} from '#lib/volumes/app-zerofs-cache.ts';
import {
  appZerofsConfigDirectory,
  appZerofsPaths,
  stageAppZerofsConfig,
} from '#lib/volumes/app-zerofs-config.ts';
import { readCacheDiskBytes } from '#lib/volumes/zerofs.ts';
import { agentConfig } from '#tests/support/config.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { s3Storage } from '#tests/support/s3-storage.ts';

const run = provided(platform);
const GIB = 1_073_741_824;
const MIB = 1_048_576;
const SECOND_APP_ID = Value.Parse(AppIdSchema, 'app-2');
const SHARED_CONFIG = '[cache]\nmemory_size_gb = 2\ndisk_size_gb = 70\n';
const SHARED_MEMORY_BYTES = 2 * GIB;
const APP_MEMORY_GIB = 0.75;
const APP_DISK_GIB = 12;
const FIRST_APP_MEMORY_MIB = 256;
const HOST_DISK_GIB = 100;
const SNAPSHOT_GIB = 8;

function host() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stateDir = yield* temporaryDirectory;
    const zerofsConfigFile = join(stateDir, 'shared.toml');
    yield* fs.writeFileString(zerofsConfigFile, SHARED_CONFIG);
    return { stateDir, zerofsConfigFile };
  });
}

function stage({
  stateDir,
  appId,
  cache,
}: {
  stateDir: string;
  appId: AppId;
  cache: Parameters<typeof stageAppZerofsConfig>[0]['cache'];
}) {
  return stageAppZerofsConfig({ appId, storage: s3Storage(), cache }).pipe(
    Effect.provide(agentConfig({ stateDir })),
  );
}

describe('staged app cache reservations', () => {
  test('hosts without app configurations reserve nothing extra', async () => {
    await run(
      Effect.gen(function* () {
        const configured = yield* host();
        expect(yield* readAppZerofsCacheMemoryBytes(configured.stateDir)).toBe(0);
        expect(yield* readAppZerofsCacheDiskBytes(configured.stateDir)).toBe(0);
        const expected = guestMemoryMib({
          hostMemoryMib: readHostMemoryMib(),
          zerofsCacheMib: SHARED_MEMORY_BYTES / MIB,
        });
        expect(yield* readGuestMemoryMib(configured)).toBe(expected);
        expect((yield* readHostCapacity(configured)).memoryMib).toBe(expected);
      }),
    );
  });

  test('an empty app configuration directory retains the shared-only budget', async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const configured = yield* host();
        const before = yield* readGuestMemoryMib(configured);
        yield* fs.makeDirectory(appZerofsConfigDirectory(configured.stateDir));
        expect(yield* readGuestMemoryMib(configured)).toBe(before);
        expect(yield* readAppZerofsCacheDiskBytes(configured.stateDir)).toBe(0);
      }),
    );
  });

  test('each staged process reserves its configured limits without a guest or registry entry', async () => {
    await run(
      Effect.gen(function* () {
        const configured = yield* host();
        const before = yield* readGuestMemoryMib(configured);
        yield* stage({
          ...configured,
          appId: APP_ID,
          cache: { memorySizeGb: 0.25, diskSizeGb: 4 },
        });
        yield* stage({
          ...configured,
          appId: SECOND_APP_ID,
          cache: { memorySizeGb: 0.5, diskSizeGb: 8 },
        });
        expect(yield* readAppZerofsCacheMemoryBytes(configured.stateDir)).toBe(
          APP_MEMORY_GIB * GIB,
        );
        expect(yield* readAppZerofsCacheDiskBytes(configured.stateDir)).toBe(APP_DISK_GIB * GIB);
        const expected = Math.max(before - (APP_MEMORY_GIB * GIB) / MIB, 0);
        expect(yield* readGuestMemoryMib(configured)).toBe(expected);
        expect((yield* readHostCapacity(configured)).memoryMib).toBe(expected);
        expect(yield* readGuestMemoryMib(configured)).toBe(expected);
      }),
    );
  });

  test('the existing shared-cache fallback still applies alongside app reservations', async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const configured = yield* host();
        const baseline = yield* readGuestMemoryMib(configured);
        yield* fs.remove(configured.zerofsConfigFile);
        expect(yield* readGuestMemoryMib(configured)).toBe(baseline);
        yield* stage({
          ...configured,
          appId: APP_ID,
          cache: { memorySizeGb: 0.25, diskSizeGb: 4 },
        });
        expect(yield* readGuestMemoryMib(configured)).toBe(
          Math.max(baseline - FIRST_APP_MEMORY_MIB, 0),
        );
      }),
    );
  });

  test('snapshots cannot consume disk promised to an app cache that has not filled yet', async () => {
    await run(
      Effect.gen(function* () {
        const configured = yield* host();
        const disk = {
          totalBytes: HOST_DISK_GIB * GIB,
          availableBytes: HOST_DISK_GIB * GIB,
          zerofsCacheBytes: yield* readCacheDiskBytes(configured.zerofsConfigFile),
          snapshotBytes: 0,
        };
        const wantedBytes = SNAPSHOT_GIB * GIB;
        expect(refusalForDisk({ disk, wantedBytes })).toBeUndefined();
        yield* stage({
          ...configured,
          appId: APP_ID,
          cache: { memorySizeGb: 0.25, diskSizeGb: 20 },
        });
        expect(
          refusalForDisk({
            disk: {
              ...disk,
              zerofsCacheBytes:
                disk.zerofsCacheBytes + (yield* readAppZerofsCacheDiskBytes(configured.stateDir)),
            },
            wantedBytes,
          }),
        ).toContain('snapshots on this host may hold');
      }),
    );
  });

  test.each([
    'invalid TOML',
    '[cache]\nmemory_size_gb = -1\ndisk_size_gb = 0',
    '[cache]\nmemory_size_gb = inf\ndisk_size_gb = inf',
    '[cache]\nmemory_size_gb = "unknown"\ndisk_size_gb = "unknown"',
  ])('an invalid app reservation offers no guest memory or snapshot disk: %s', async (contents) => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const configured = yield* host();
        const paths = yield* stage({
          ...configured,
          appId: APP_ID,
          cache: { memorySizeGb: 0.25, diskSizeGb: 4 },
        });
        yield* fs.writeFileString(paths.configFile, contents);
        expect(yield* readGuestMemoryMib(configured)).toBe(0);
        const disk = yield* Effect.either(readAppZerofsCacheDiskBytes(configured.stateDir));
        expect(Either.isLeft(disk) && disk.left._tag).toBe('AppZerofsCacheUnknown');
      }),
    );
  });

  test('an incomplete staged configuration is not mistaken for an unused cache', async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const configured = yield* host();
        const paths = appZerofsPaths({ stateDir: configured.stateDir, appId: APP_ID });
        yield* fs.makeDirectory(dirname(paths.configFile), { recursive: true });
        expect(yield* readGuestMemoryMib(configured)).toBe(0);
        const disk = yield* Effect.either(readAppZerofsCacheDiskBytes(configured.stateDir));
        expect(Either.isLeft(disk) && disk.left._tag).toBe('AppZerofsCacheUnknown');
      }),
    );
  });

  test('an unreadable configuration directory refuses admission without exposing its error', async () => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const configured = yield* host();
        const unreadable = FileSystem.makeNoop({
          ...fs,
          readDirectory: () =>
            Effect.fail(
              new SystemError({
                module: 'FileSystem',
                method: 'readDirectory',
                reason: 'PermissionDenied',
                description: 'private credentials',
              }),
            ),
        });
        expect(
          yield* readGuestMemoryMib(configured).pipe(
            Effect.provideService(FileSystem.FileSystem, unreadable),
          ),
        ).toBe(0);
        const disk = yield* Effect.either(readAppZerofsCacheDiskBytes(configured.stateDir)).pipe(
          Effect.provideService(FileSystem.FileSystem, unreadable),
        );
        expect(Either.isLeft(disk) && disk.left.message).toBe(
          'The app ZeroFS cache reservations could not be read.',
        );
      }),
    );
  });
});
