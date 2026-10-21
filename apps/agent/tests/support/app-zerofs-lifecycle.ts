import { dirname } from 'node:path';
import { FileSystem, Path } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import { Effect, Layer, Option } from 'effect';
import type { CommandRequest } from '#lib/exec.ts';
import { describeSlot, FIRST_SLOT } from '#lib/network/slot.ts';
import { APP_ZEROFS_CACHE } from '#lib/volumes/app-zerofs-cache.ts';
import { appZerofsConfigContents, appZerofsPaths } from '#lib/volumes/app-zerofs-config.ts';
import { appZerofsRetirementPath } from '#lib/volumes/app-zerofs-retirement.ts';
import { appZerofsUnits } from '#lib/volumes/app-zerofs-systemd.ts';
import { AppVolumeFiles } from '#services/app-volume-files.service.ts';
import { AppVolumeNbd } from '#services/app-volume-nbd.service.ts';
import { AppZerofs } from '#services/app-zerofs.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { AGENT_CONFIG, agentConfig } from '#tests/support/config.ts';
import { APP_ID, desiredVolume, VOLUME_ID } from '#tests/support/fixtures.ts';
import { privateNbdProcess } from '#tests/support/nbd.ts';
import { temporaryDirectory } from '#tests/support/run.ts';
import { s3Storage } from '#tests/support/s3-storage.ts';
import { systemdUnitProperties } from '#tests/support/systemd.ts';

function missing(method: string) {
  return new SystemError({ module: 'FileSystem', method, reason: 'NotFound' });
}

function forgetTree({ persisted, root }: { persisted: Map<string, string>; root: string }) {
  for (const file of persisted.keys()) {
    if (file === root || file.startsWith(`${root}/`)) {
      persisted.delete(file);
    }
  }
}

export function appZerofsLifecycleHost() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* temporaryDirectory;
    const info = yield* fs.stat(directory);
    const syncFile = yield* fs.open(path.join(directory, 'sync-target'), { flag: 'w' });
    const stateDir = '/var/lib/nibrun';
    const paths = appZerofsPaths({ appId: APP_ID, stateDir });
    const receipt = appZerofsRetirementPath({ appId: APP_ID, stateDir });
    const storage = s3Storage();
    const desired = desiredVolume({ desiredState: 'absent', storage });
    const contents = appZerofsConfigContents({
      appId: APP_ID,
      stateDir,
      storage,
      cache: APP_ZEROFS_CACHE,
    });
    const persisted = new Map([
      [paths.configFile, contents],
      [path.join(paths.cacheDirectory, 'segment'), 'cache bytes'],
    ]);
    const events: string[] = [];
    const faults = new Set<
      | 'flush-data'
      | 'flush-deletion'
      | 'stop'
      | 'receipt'
      | 'still-running'
      | 'sync'
      | 'cache-remove'
      | 'config-remove'
      | 'data-mount'
    >();
    const state = { attached: true, allocated: true, image: true, running: true, mounted: true };
    const slot = describeSlot({ slot: FIRST_SLOT, appId: APP_ID });
    const target = {
      socketPath: paths.sockets.nbd,
      devicePath: slot.nbdDevicePath,
      volumeId: VOLUME_ID,
    };
    const process = privateNbdProcess(target);
    function removeLocal(name: string) {
      const phase = name === paths.cacheDirectory ? 'cache-remove' : 'config-remove';
      if (name !== paths.cacheDirectory && name !== dirname(paths.configFile)) {
        return Effect.die('cleanup must remove only app cache/config directories');
      }
      events.push(phase);
      if (faults.has(phase)) {
        return Effect.fail(
          new SystemError({ module: 'FileSystem', method: 'remove', reason: 'PermissionDenied' }),
        );
      }
      forgetTree({ persisted, root: name });
      return Effect.void;
    }
    const files = FileSystem.layerNoop({
      exists: (name) => Effect.succeed(persisted.has(name)),
      readDirectory: (directory) =>
        Effect.succeed([
          ...new Set(
            [...persisted.keys()]
              .filter((name) => name.startsWith(`${directory}/`))
              .map((name) => name.slice(directory.length + 1).split('/')[0] ?? ''),
          ),
        ]),
      stat: (name) =>
        Effect.succeed({
          ...info,
          dev:
            name === AGENT_CONFIG.zerofsMount || (name === paths.mountPath && state.mounted)
              ? info.dev + 1
              : info.dev,
        }),
      readFileString: (name) => {
        const attrs: Record<string, string | undefined> = {
          '/sys/block/nbd0/pid': state.attached ? '123\n' : undefined,
          '/proc/123/cmdline': process.cmdline,
          '/proc/123/cgroup': process.cgroup,
        };
        const value = persisted.get(name) ?? attrs[name];
        return value === undefined ? Effect.fail(missing('readFileString')) : Effect.succeed(value);
      },
      makeDirectory: () => Effect.void,
      chmod: () => Effect.void,
      open: () =>
        Effect.succeed({
          ...syncFile,
          sync: Effect.gen(function* () {
            events.push('sync');
            if (faults.has('sync')) {
              return yield* new SystemError({
                module: 'FileSystem',
                method: 'sync',
                reason: 'PermissionDenied',
              });
            }
          }),
        }),
      makeTempDirectoryScoped: () =>
        Effect.acquireRelease(Effect.succeed('/staging'), () =>
          Effect.sync(() => {
            for (const name of persisted.keys()) {
              if (name.startsWith('/staging/')) {
                persisted.delete(name);
              }
            }
          }),
        ),
      remove: removeLocal,
      writeFileString: (...args) =>
        Effect.sync(() => {
          persisted.set(args[0], args[1]);
        }),
      link: (...args) =>
        persisted.has(args[1])
          ? Effect.fail(
              new SystemError({ module: 'FileSystem', method: 'link', reason: 'AlreadyExists' }),
            )
          : Effect.die('retirement must not create a new configuration'),
      rename: (...args) =>
        Effect.gen(function* () {
          if (faults.has('receipt')) {
            return yield* new SystemError({
              module: 'FileSystem',
              method: 'rename',
              reason: 'PermissionDenied',
            });
          }
          const value = persisted.get(args[0]);
          if (value === undefined) {
            return yield* missing('rename');
          }
          persisted.set(args[1], value);
          persisted.delete(args[0]);
          events.push('receipt');
        }),
    });
    const units = appZerofsUnits(APP_ID);
    function unitStates() {
      return [
        systemdUnitProperties({
          id: units.server,
          activeState: state.running ? 'active' : 'inactive',
          subState: state.running ? 'running' : 'dead',
        }),
        systemdUnitProperties({
          id: units.mount,
          activeState: state.mounted ? 'active' : 'inactive',
          subState: state.mounted ? 'running' : 'dead',
        }),
      ].join('\n\n');
    }
    function stop() {
      events.push('stop');
      if (faults.has('stop')) {
        return succeeding({ code: 1 });
      }
      state.running = faults.has('still-running');
      state.mounted = false;
      return succeeding();
    }
    function flush() {
      const phase = state.image ? 'flush-data' : 'flush-deletion';
      events.push(phase);
      return succeeding({ code: faults.has(phase) ? 1 : 0, stderr: 'customer-secret-key' });
    }
    function answer({ command }: CommandRequest) {
      if (command[0] === 'mountpoint' && faults.has('data-mount')) {
        return succeeding({ code: 1 });
      }
      switch (command[1]) {
        case 'flush':
          return flush();
        case 'start':
          events.push('start');
          state.running = true;
          state.mounted = true;
          return succeeding();
        case 'stop':
          return stop();
        case 'show':
          return succeeding({ stdout: unitStates() });
        default:
          return succeeding();
      }
    }
    const commands = recordingCommands(answer);
    const allocator = Layer.succeed(
      SlotAllocator,
      SlotAllocator.make({
        allocate: () => Effect.die('retirement must not allocate a slot'),
        allocateWithNbdDevice: () => Effect.die('retirement must not allocate a slot'),
        lookup: () => Effect.succeed(state.allocated ? Option.some(slot) : Option.none()),
        release: () =>
          Effect.sync(() => {
            state.allocated = false;
            events.push('release');
          }),
        slots: Effect.succeed([slot]),
        persist: Effect.void,
      }),
    );
    const images = Layer.succeed(
      AppVolumeFiles,
      AppVolumeFiles.make({
        ensure: () => Effect.die('retirement must not create an image'),
        size: () => Effect.die('retirement must not inspect image size'),
        remove: () =>
          Effect.sync(() => {
            state.image = false;
            events.push('remove');
          }),
      }),
    );
    const nbd = Layer.succeed(
      AppVolumeNbd,
      AppVolumeNbd.make({
        reattach: () => Effect.die('retirement must not attach a device'),
        detach: () =>
          Effect.sync(() => {
            state.attached = false;
            events.push('detach');
          }),
      }),
    );
    const config = agentConfig({ stateDir });
    const dependencies = Layer.mergeAll(
      config,
      files,
      commands.layer,
      allocator,
      images,
      nbd,
      Layer.succeed(Path.Path, path),
    );
    const layer = AppZerofs.DefaultWithoutDependencies.pipe(
      Layer.provideMerge(
        ZerofsTopology.DefaultWithoutDependencies.pipe(Layer.provideMerge(dependencies)),
      ),
    );
    return { desired, paths, receipt, contents, persisted, events, faults, state, commands, layer };
  });
}
