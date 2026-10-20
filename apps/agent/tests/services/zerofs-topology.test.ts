import { describe, expect, test } from 'bun:test';
import { type AppId, AppIdSchema, ObjectKeySchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Either, Layer, Logger, Option } from 'effect';
import type { CommandLine } from '#lib/exec.ts';
import { appZerofsFilesystem } from '#lib/volumes/app-zerofs-filesystem.ts';
import type { ZerofsLiveFilesystem } from '#lib/volumes/topology.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { AGENT_CONFIG, agentConfig } from '#tests/support/config.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { provided } from '#tests/support/run.ts';

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
    Effect.map((filesystem) => ({ appId, filesystem })),
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

describe('registered app filesystems participate in durability flushes', () => {
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
        yield* host.registerAppFilesystem({ appId: first.appId, filesystem: mutable });
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
