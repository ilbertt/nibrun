import { describe, expect, test } from 'bun:test';
import { dirname } from 'node:path';
import { FileSystem } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import { type AppId, AppIdSchema, ObjectKeySchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Either, Layer, Logger, Option } from 'effect';
import type { CommandLine } from '#lib/exec.ts';
import { appZerofsPaths } from '#lib/volumes/app-zerofs-config.ts';
import { appZerofsFilesystem } from '#lib/volumes/app-zerofs-filesystem.ts';
import { usesAppVolumeStorage } from '#lib/volumes/placement.ts';
import type { ZerofsLiveFilesystem } from '#lib/volumes/topology.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { AGENT_CONFIG, agentConfig } from '#tests/support/config.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { s3Storage } from '#tests/support/s3-storage.ts';

const SECOND_APP_ID = Value.Parse(AppIdSchema, 'app-2');

function topology() {
  return Effect.runSync(
    Effect.provide(
      ZerofsTopology,
      ZerofsTopology.DefaultWithoutDependencies.pipe(Layer.provide(agentConfig())),
    ),
  );
}

function registration(appId: AppId) {
  return appZerofsFilesystem({
    appId,
    storagePrefix: Value.Parse(ObjectKeySchema, 'customer/filesystem'),
  }).pipe(
    Effect.map((filesystem) => ({
      appId,
      filesystem,
      storage: s3Storage({ prefix: filesystem.storagePrefix, bucket: `customer-${appId}` }),
    })),
    Effect.provide(agentConfig({ stateDir: '/var/lib/nibrun' })),
  );
}

function flushCommand(filesystem: ZerofsLiveFilesystem): CommandLine {
  return [filesystem.admin.binary, 'flush', '-c', filesystem.admin.configFile];
}

describe('the host decides where a volume goes', () => {
  test('a volume is placed in the filesystem this host serves', () => {
    const filesystem = topology().place();

    expect(filesystem.storagePrefix).toBe(AGENT_CONFIG.zerofsStoragePrefix);
    expect(filesystem.mountPath).toBe(AGENT_CONFIG.zerofsMount);
    expect(filesystem.nbdSocketPath).toBe(AGENT_CONFIG.zerofsNbdSocket);
    expect(filesystem.admin.configFile).toBe(AGENT_CONFIG.zerofsConfigFile);
  });

  test('placing twice lands in the same filesystem', () => {
    const host = topology();

    expect(host.place().storagePrefix).toBe(host.place().storagePrefix);
  });

  test('the shared filesystems stay enumerable', () => {
    expect(topology().all.map((filesystem) => filesystem.storagePrefix)).toEqual([
      AGENT_CONFIG.zerofsStoragePrefix,
    ]);
  });
});

describe('private storage identity survives an agent restart', () => {
  test('an incomplete staging directory guards only its app without reading credentials', async () => {
    await provided(platform)(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* temporaryDirectory;
        const host = yield* ZerofsTopology.pipe(
          Effect.provide(
            ZerofsTopology.DefaultWithoutDependencies.pipe(
              Layer.provide(agentConfig({ stateDir })),
            ),
          ),
        );
        expect(yield* host.usesAppStorage(APP_ID)).toBe(false);
        const configFile = appZerofsPaths({ appId: APP_ID, stateDir }).configFile;
        yield* fs.makeDirectory(dirname(configFile), { recursive: true });
        expect(yield* host.usesAppStorage(APP_ID)).toBe(true);
        expect(Option.isNone(yield* host.lookupAppFilesystem(APP_ID))).toBe(true);
        expect(yield* host.usesAppStorage(SECOND_APP_ID)).toBe(false);
        yield* fs.writeFileString(configFile, 'unreadable or incomplete credentials');
        expect(
          yield* usesAppVolumeStorage({ appId: APP_ID, storage: undefined }).pipe(
            Effect.provideService(ZerofsTopology, host),
          ),
        ).toBe(true);
        expect(host.all).toEqual([host.place()]);
      }),
    );
  });

  test('a staging inspection error refuses fallback and exposes no filesystem details', async () => {
    await provided(platform)(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* temporaryDirectory;
        const host = yield* ZerofsTopology.pipe(
          Effect.provide(
            ZerofsTopology.DefaultWithoutDependencies.pipe(
              Layer.provide(agentConfig({ stateDir })),
            ),
          ),
        );
        const result = yield* host.usesAppStorage(APP_ID).pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fs,
            stat: () =>
              Effect.fail(
                new SystemError({
                  module: 'FileSystem',
                  method: 'stat',
                  reason: 'PermissionDenied',
                  pathOrDescriptor: 'customer-private-path',
                }),
              ),
          }),
          Effect.either,
        );
        expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsFilesystemUnavailable');
        expect(JSON.stringify(result)).not.toContain('customer-private-path');
      }),
    );
  });
});

describe('registered app filesystems participate in durability flushes', () => {
  test('retiring one app removes only its flush target and preserves shared placement', async () => {
    const commands = recordingCommands();
    const host = topology();
    await provided(commands.layer)(
      Effect.gen(function* () {
        const first = yield* registration(APP_ID);
        const second = yield* registration(SECOND_APP_ID);
        yield* host.registerAppFilesystem(first);
        yield* host.registerAppFilesystem(second);
        yield* host.unregisterAppFilesystem(first);
        yield* host.unregisterAppFilesystem(first);
        expect(Option.isNone(yield* host.lookupAppFilesystem(APP_ID))).toBe(true);
        expect(Option.isSome(yield* host.lookupAppFilesystem(SECOND_APP_ID))).toBe(true);
        yield* host.flushAll;
        expect(commands.commands.map(({ command }) => command)).toEqual([
          flushCommand(host.place()),
          flushCommand(second.filesystem),
        ]);
      }),
    );
  });

  test('a different registration cannot unregister the current writer', async () => {
    const host = topology();
    await provided(Layer.empty)(
      Effect.gen(function* () {
        const original = yield* registration(APP_ID);
        yield* host.registerAppFilesystem(original);
        const removed = yield* Effect.either(
          host.unregisterAppFilesystem({
            ...original,
            storage: s3Storage({ bucket: 'another-bucket', prefix: original.storage.prefix }),
          }),
        );
        expect(Either.isLeft(removed) && removed.left._tag).toBe('AppZerofsFilesystemConflict');
        expect(Option.isSome(yield* host.lookupAppFilesystem(APP_ID))).toBe(true);
      }),
    );
  });

  test('an empty registry keeps the existing shared flush behavior', async () => {
    const commands = recordingCommands();
    const host = topology();
    await provided(commands.layer)(host.flushAll.pipe(Effect.andThen(host.flushAll)));
    expect(commands.commands.map(({ command }) => command)).toEqual([
      flushCommand(host.place()),
      flushCommand(host.place()),
    ]);
  });

  test('registration changes no placement and flushes each backend even with equal relative prefixes', async () => {
    const commands = recordingCommands();
    const host = topology();
    const selected = host.place();
    const expected = [flushCommand(selected)];
    await provided(commands.layer)(
      Effect.gen(function* () {
        const first = yield* registration(APP_ID);
        const second = yield* registration(SECOND_APP_ID);
        expected.push(flushCommand(first.filesystem), flushCommand(second.filesystem));
        yield* host.registerAppFilesystem(first);
        yield* host.registerAppFilesystem(second);
        expect(commands.commands).toEqual([]);
        expect(host.place()).toBe(selected);
        expect(host.all).toEqual([selected]);
        yield* host.flushAll;
      }),
    );
    expect(commands.commands.map(({ command }) => command)).toEqual(expected);
  });

  test('repeat and concurrent identical registrations flush the app only once', async () => {
    const commands = recordingCommands();
    const host = topology();
    await provided(commands.layer)(
      Effect.gen(function* () {
        const first = yield* registration(APP_ID);
        const reordered = {
          appId: first.appId,
          storage: first.storage,
          filesystem: {
            admin: {
              configFile: first.filesystem.admin.configFile,
              binary: first.filesystem.admin.binary,
            },
            nbdSocketPath: first.filesystem.nbdSocketPath,
            mountPath: first.filesystem.mountPath,
            storagePrefix: first.filesystem.storagePrefix,
          },
        };
        yield* Effect.all(
          [host.registerAppFilesystem(first), host.registerAppFilesystem(reordered)],
          { concurrency: 'unbounded' },
        );
        yield* host.registerAppFilesystem(first);
        yield* host.flushAll;
        expect(commands.commands.map(({ command }) => command)).toEqual([
          flushCommand(host.place()),
          flushCommand(first.filesystem),
        ]);
      }),
    );
  });

  test('a conflicting registration leaves the original backend registered', async () => {
    const commands = recordingCommands();
    const host = topology();
    await provided(commands.layer)(
      Effect.gen(function* () {
        const first = yield* registration(APP_ID);
        const replacement = yield* registration(SECOND_APP_ID);
        yield* host.registerAppFilesystem(first);
        const result = yield* Effect.either(
          host.registerAppFilesystem({
            appId: APP_ID,
            filesystem: replacement.filesystem,
            storage: replacement.storage,
          }),
        );
        expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsFilesystemConflict');
        yield* host.flushAll;
        expect(commands.commands.map(({ command }) => command)).toEqual([
          flushCommand(host.place()),
          flushCommand(first.filesystem),
        ]);
      }),
    );
  });

  test.each([
    { source: 'shared', field: 'mountPath' },
    { source: 'shared', field: 'nbdSocketPath' },
    { source: 'shared', field: 'configFile' },
    { source: 'app', field: 'mountPath' },
    { source: 'app', field: 'nbdSocketPath' },
    { source: 'app', field: 'configFile' },
  ] as const)('host endpoints cannot alias another filesystem: %j', async ({ source, field }) => {
    const commands = recordingCommands();
    const host = topology();
    await provided(commands.layer)(
      Effect.gen(function* () {
        const first = yield* registration(APP_ID);
        const second = yield* registration(SECOND_APP_ID);
        yield* host.registerAppFilesystem(first);
        const occupied = source === 'shared' ? host.place() : first.filesystem;
        const filesystem =
          field === 'configFile'
            ? {
                ...second.filesystem,
                admin: { ...second.filesystem.admin, configFile: occupied.admin.configFile },
              }
            : { ...second.filesystem, [field]: occupied[field] };
        const result = yield* Effect.either(
          host.registerAppFilesystem({
            appId: second.appId,
            filesystem,
            storage: second.storage,
          }),
        );
        expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsFilesystemConflict');
        yield* host.flushAll;
        expect(commands.commands.map(({ command }) => command)).toEqual([
          flushCommand(host.place()),
          flushCommand(first.filesystem),
        ]);
      }),
    );
  });

  test('mutating the caller metadata cannot redirect later flushes', async () => {
    const commands = recordingCommands();
    const host = topology();
    await provided(commands.layer)(
      Effect.gen(function* () {
        const first = yield* registration(APP_ID);
        const mutable = { ...first.filesystem, admin: { ...first.filesystem.admin } };
        yield* host.registerAppFilesystem({
          appId: first.appId,
          filesystem: mutable,
          storage: first.storage,
        });
        mutable.admin.configFile = '/unexpected/config.toml';
        mutable.mountPath = '/unexpected/mount';
        yield* host.flushAll;
        expect(commands.commands.map(({ command }) => command)).toEqual([
          flushCommand(host.place()),
          flushCommand(first.filesystem),
        ]);
      }),
    );
  });

  test('an existing flush effect includes registrations made after its previous execution', async () => {
    const commands = recordingCommands();
    const host = topology();
    await provided(commands.layer)(
      Effect.gen(function* () {
        yield* host.flushAll;
        const first = yield* registration(APP_ID);
        yield* host.registerAppFilesystem(first);
        yield* host.flushAll;
        expect(commands.commands.map(({ command }) => command)).toEqual([
          flushCommand(host.place()),
          flushCommand(host.place()),
          flushCommand(first.filesystem),
        ]);
      }),
    );
  });

  test('a shared flush failure still attempts all registered app backends', async () => {
    const commands = recordingCommands(({ command }) =>
      succeeding({
        code: command.includes(AGENT_CONFIG.zerofsConfigFile) ? 1 : 0,
      }),
    );
    const host = topology();
    await provided(commands.layer)(
      Effect.gen(function* () {
        const first = yield* registration(APP_ID);
        const second = yield* registration(SECOND_APP_ID);
        yield* host.registerAppFilesystem(first);
        yield* host.registerAppFilesystem(second);
        yield* host.flushAll;
        expect(commands.commands.map(({ command }) => command)).toEqual([
          flushCommand(host.place()),
          flushCommand(first.filesystem),
          flushCommand(second.filesystem),
        ]);
      }),
    );
  });

  test('an app flush failure is sanitized and does not skip the next backend', async () => {
    const commands = recordingCommands(({ command }) =>
      succeeding({
        code: command.includes(`/var/lib/nibrun/zerofs/${APP_ID}/config.toml`) ? 1 : 0,
        stdout: 'customer-access-key',
        stderr: 'customer-secret-key',
      }),
    );
    const logs: string[] = [];
    const capturing = Logger.replace(
      Logger.defaultLogger,
      Logger.make(({ message, annotations }) => {
        logs.push(JSON.stringify({ message, annotations: Object.fromEntries(annotations) }));
      }),
    );
    const host = topology();
    await provided(Layer.merge(commands.layer, capturing))(
      Effect.gen(function* () {
        const first = yield* registration(APP_ID);
        const second = yield* registration(SECOND_APP_ID);
        yield* host.registerAppFilesystem(first);
        yield* host.registerAppFilesystem(second);
        yield* host.flushAll;
        expect(commands.commands.map(({ command }) => command)).toEqual([
          flushCommand(host.place()),
          flushCommand(first.filesystem),
          flushCommand(second.filesystem),
        ]);
      }),
    );
    expect(logs).toHaveLength(1);
    expect(logs.join()).toContain('AppZerofsFlushError');
    expect(logs.join()).not.toContain('customer-access-key');
    expect(logs.join()).not.toContain('customer-secret-key');
  });
});

describe('looking up a registered app filesystem', () => {
  test('a lookup reads current registration without falling back or changing shared placement', async () => {
    const host = topology();
    const lookup = host.lookupAppFilesystem(APP_ID);
    await provided(Layer.empty)(
      Effect.gen(function* () {
        const shared = host.place();
        expect(Option.isNone(yield* lookup)).toBe(true);
        const first = yield* registration(APP_ID);
        yield* host.registerAppFilesystem(first);
        expect(Option.getOrThrow(yield* lookup)).toEqual(first.filesystem);
        expect(Option.isNone(yield* host.lookupAppFilesystem(SECOND_APP_ID))).toBe(true);
        expect(host.place()).toBe(shared);
        expect(host.all).toEqual([shared]);
      }),
    );
  });

  test('equal relative prefixes still resolve to distinct app endpoints', async () => {
    const host = topology();
    await provided(Layer.empty)(
      Effect.gen(function* () {
        const first = yield* registration(APP_ID);
        const second = yield* registration(SECOND_APP_ID);
        yield* host.registerAppFilesystem(first);
        yield* host.registerAppFilesystem(second);
        expect(first.filesystem.storagePrefix).toBe(second.filesystem.storagePrefix);
        expect(Option.getOrThrow(yield* host.lookupAppFilesystem(APP_ID))).toEqual(
          first.filesystem,
        );
        expect(Option.getOrThrow(yield* host.lookupAppFilesystem(SECOND_APP_ID))).toEqual(
          second.filesystem,
        );
      }),
    );
  });

  test('mutating lookup results cannot redirect subsequent lookup or durability flushes', async () => {
    const commands = recordingCommands();
    const host = topology();
    await provided(commands.layer)(
      Effect.gen(function* () {
        const first = yield* registration(APP_ID);
        yield* host.registerAppFilesystem(first);
        const selected = Option.getOrThrow(yield* host.lookupAppFilesystem(APP_ID));
        Object.assign(selected, {
          mountPath: '/unexpected/mount',
          nbdSocketPath: '/unexpected/socket',
        });
        Object.assign(selected.admin, { configFile: '/unexpected/config.toml' });
        expect(Option.getOrThrow(yield* host.lookupAppFilesystem(APP_ID))).toEqual(
          first.filesystem,
        );
        yield* host.flushAll;
        expect(commands.commands.map(({ command }) => command)).toEqual([
          flushCommand(host.place()),
          flushCommand(first.filesystem),
        ]);
      }),
    );
  });
});

describe('resolving a configured app filesystem', () => {
  test('an unregistered app cannot resolve another app backend', async () => {
    const host = topology();
    await provided(Layer.empty)(
      Effect.gen(function* () {
        const first = yield* registration(APP_ID);
        const storage = s3Storage({ prefix: first.filesystem.storagePrefix });
        const lookup = host.resolveAppFilesystem({ appId: APP_ID, storage });
        expect(Either.isLeft(yield* Effect.either(lookup))).toBe(true);
        yield* host.registerAppFilesystem(yield* registration(SECOND_APP_ID));
        const unavailable = yield* Effect.either(lookup);
        expect(Either.isLeft(unavailable) && unavailable.left._tag).toBe(
          'AppZerofsFilesystemUnavailable',
        );
      }),
    );
  });

  test('a matching full configuration resolves to the private filesystem', async () => {
    const host = topology();
    await provided(Layer.empty)(
      Effect.gen(function* () {
        const first = yield* registration(APP_ID);
        const storage = s3Storage({ prefix: first.filesystem.storagePrefix });
        yield* host.registerAppFilesystem({ ...first, storage });
        expect(yield* host.resolveAppFilesystem({ appId: APP_ID, storage })).toEqual(
          first.filesystem,
        );
        expect(host.place().admin.configFile).toBe(AGENT_CONFIG.zerofsConfigFile);
      }),
    );
  });

  test.each([
    { endpoint: 'https://another.example.com' },
    { bucket: 'another-bucket' },
    { prefix: 'another/prefix' },
    { region: 'another-region' },
    { auth: { kind: 'anonymous' } },
    { encryptionPassword: 'another-secret-password' },
  ])(
    'a changed backend configuration never resolves to the registered filesystem: %j',
    async (overrides) => {
      const host = topology();
      await provided(Layer.empty)(
        Effect.gen(function* () {
          const first = yield* registration(APP_ID);
          const storage = s3Storage({ prefix: first.filesystem.storagePrefix });
          yield* host.registerAppFilesystem({ ...first, storage });
          const result = yield* Effect.either(
            host.resolveAppFilesystem({
              appId: APP_ID,
              storage: s3Storage({ ...storage, ...overrides }),
            }),
          );
          expect(Either.isLeft(result) && result.left._tag).toBe('AppZerofsConfigConflict');
          expect(JSON.stringify(result)).not.toContain(storage.encryptionPassword);
          expect(JSON.stringify(result)).not.toContain('another-secret-password');
        }),
      );
    },
  );

  test('caller mutations cannot change the storage identity or resolved endpoints', async () => {
    const host = topology();
    await provided(Layer.empty)(
      Effect.gen(function* () {
        const first = yield* registration(APP_ID);
        const storage = s3Storage({ prefix: first.filesystem.storagePrefix });
        const expected = s3Storage({ prefix: first.filesystem.storagePrefix });
        yield* host.registerAppFilesystem({ ...first, storage });
        storage.bucket = 'mutated-bucket';
        Object.assign(storage.auth, { secretAccessKey: 'mutated-key' });
        const resolved = yield* host.resolveAppFilesystem({ appId: APP_ID, storage: expected });
        resolved.admin.configFile = '/unexpected/config.toml';
        expect(yield* host.resolveAppFilesystem({ appId: APP_ID, storage: expected })).toEqual(
          first.filesystem,
        );
      }),
    );
  });
});
