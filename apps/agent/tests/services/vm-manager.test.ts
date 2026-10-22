import { describe, expect, test } from 'bun:test';
import { dirname } from 'node:path';
import { FileSystem } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import type { HostVersions } from '@repo/protocol';
import { Effect, Either, Layer } from 'effect';
import { writeJsonFile } from '#lib/json-store.ts';
import { describeSlot, FIRST_SLOT } from '#lib/network/slot.ts';
import { VM_TEMPLATE_UNIT_FILE } from '#lib/vm/app-storage-unit.ts';
import type { FirecrackerConfig } from '#lib/vm/firecracker-config.ts';
import { type SnapshotStamp, snapshotPaths } from '#lib/vm/snapshot.ts';
import * as Systemd from '#lib/vm/systemd.ts';
import { appZerofsPaths } from '#lib/volumes/app-zerofs-config.ts';
import { appZerofsFilesystem } from '#lib/volumes/app-zerofs-filesystem.ts';
import type { ZerofsLiveFilesystem } from '#lib/volumes/topology.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { ArtifactImages } from '#services/artifact-images.service.ts';
import { ArtifactTransferError } from '#services/artifact-store.service.ts';
import { CronRegistrationReceiver } from '#services/cron-registration-receiver.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { TenantLogReceiver } from '#services/tenant-log-receiver.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { agentConfig } from '#tests/support/config.ts';
import { servingFirecracker } from '#tests/support/firecracker.ts';
import {
  APP_ID,
  DEPLOYMENT_ID,
  desiredInstance,
  desiredState,
  desiredVolume,
  instanceRecord,
  VOLUME_ID,
} from '#tests/support/fixtures.ts';
import { installedGuestImage } from '#tests/support/guest-image.ts';
import { privateNbdProcess } from '#tests/support/nbd.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { s3Storage } from '#tests/support/s3-storage.ts';

const run = provided(platform);

const SLOT = describeSlot({ slot: FIRST_SLOT, appId: APP_ID });

/** Where `readHostBootId` reads, answered here so the stamp can match on a host with no such file. */
const HOST_BOOT_ID_PATH = '/proc/sys/kernel/random/boot_id';
const HOST_BOOT_ID = 'b6b8f0d2-0000-4000-8000-000000000001';

const versions: HostVersions = {
  agent: 'abc1234',
  guestImage: '2026.08.01',
  zerofs: '0.5.0',
  firecracker: '1.16.1',
};

const stamp: SnapshotStamp = {
  deploymentId: DEPLOYMENT_ID,
  guestImageVersion: versions.guestImage,
  guestRootfsPath: `/images/${versions.guestImage}/rootfs.ext4`,
  hostBootId: HOST_BOOT_ID,
  slot: SLOT.slot,
};

function hostBooted({
  bootId,
  filesystem,
  storage,
}: {
  bootId: string;
  filesystem: ZerofsLiveFilesystem;
  storage: { ready: boolean };
}) {
  return Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const info = yield* fs.stat('/');
      const mounts = new Set([filesystem.mountPath, '/mnt/zerofs']);
      const parents = new Set([...mounts].map(dirname));
      const process = privateNbdProcess({
        socketPath: filesystem.nbdSocketPath,
        devicePath: SLOT.nbdDevicePath,
        volumeId: VOLUME_ID,
      });
      const attributes: Record<string, string> = {
        '/sys/block/nbd0/pid': '123\n',
        '/sys/block/nbd0/size': '8\n',
        '/proc/123/cmdline': process.cmdline,
        '/proc/123/cgroup': process.cgroup,
      };
      function isStorageFile(path: string) {
        return (
          path.startsWith('/sys/block/nbd0/') ||
          path === VM_TEMPLATE_UNIT_FILE ||
          Object.hasOwn(attributes, path)
        );
      }
      return {
        ...fs,
        stat: (path: string) =>
          storage.ready && mounts.has(path)
            ? Effect.succeed({ ...info, dev: info.dev + 1 })
            : storage.ready && parents.has(path)
              ? Effect.succeed(info)
              : fs.stat(path),
        readFileString: (...read: Parameters<FileSystem.FileSystem['readFileString']>) => {
          const [path] = read;
          if (storage.ready && isStorageFile(path)) {
            const value = attributes[path];
            return value === undefined
              ? Effect.fail(
                  new SystemError({
                    module: 'FileSystem',
                    method: 'readFileString',
                    reason: 'NotFound',
                  }),
                )
              : Effect.succeed(value);
          }
          return path === HOST_BOOT_ID_PATH ? Effect.succeed(bootId) : fs.readFileString(...read);
        },
      };
    }),
  );
}

/** A wake restores what is already on the host, so reaching the image builder is the failure. */
const noArtifactImages = Layer.succeed(
  ArtifactImages,
  ArtifactImages.make({
    ensure: () => new ArtifactTransferError({ cause: 'no artifact images in a test' }),
  }),
);

const VERB_ARGUMENT = 1;
const START_REFUSED = 1;

/** systemd refusing the unit — a burst limit hit, a runtime directory gone — and nothing else failing. */
function systemctlRefusingStart() {
  return recordingCommands(({ command }) =>
    succeeding(
      command[VERB_ARGUMENT] === 'start'
        ? { code: START_REFUSED, stderr: 'Start request repeated too quickly.' }
        : {},
    ),
  );
}

/**
 * A host holding a snapshot this wake may load — the stamp matching, the files beside it — and a
 * systemd that will not start the unit. What is on disk is read back afterwards rather than
 * remembered, because what the wake left there is the whole question.
 */
function hostAsleepAndRefusing() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const snapshotDir = yield* temporaryDirectory;
    const imageHost = yield* installedGuestImage(versions.guestImage);
    const runtimeDir = yield* temporaryDirectory;
    const stateDir = yield* temporaryDirectory;
    const storage = { ready: false };
    const filesystem = yield* appZerofsFilesystem({
      appId: APP_ID,
      storagePrefix: s3Storage().prefix,
    }).pipe(Effect.provide(agentConfig({ stateDir })));
    const paths = snapshotPaths({ snapshotDir, appId: APP_ID });
    yield* fs.makeDirectory(paths.directory, { recursive: true });
    yield* fs.writeFileString(paths.statePath, 'the vmm as it was');
    yield* fs.writeFileString(paths.memoryPath, 'the guest as it was');
    yield* writeJsonFile({
      path: paths.stampPath,
      value: { ...stamp, guestRootfsPath: imageHost.image.rootfsPath },
    });

    const systemctl = systemctlRefusingStart();
    const host = Layer.mergeAll(
      agentConfig({
        stateDir,
        vmSnapshotDir: snapshotDir,
        vmDir: yield* temporaryDirectory,
        versionsFile: imageHost.versionsFile,
        guestImageDir: imageHost.guestImageDir,
        runtimeDir,
        desiredStateFile: `${snapshotDir}/desired-state.json`,
      }),
      systemctl.layer,
      hostBooted({ bootId: HOST_BOOT_ID, filesystem, storage }),
    ).pipe(Layer.provideMerge(platform));
    const services = VmManager.DefaultWithoutDependencies.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          AgentState.Default,
          noArtifactImages,
          TenantLogReceiver.Default,
          Layer.succeed(
            CronRegistrationReceiver,
            CronRegistrationReceiver.make({ attach: () => Effect.void, detach: () => Effect.void }),
          ),
          ZerofsTopology.DefaultWithoutDependencies,
          DesiredStateCache.DefaultWithoutDependencies,
        ),
      ),
      Layer.provideMerge(host),
    );
    const wake = Effect.flatMap(VmManager, (vms) =>
      vms.wake({ appId: APP_ID, deploymentId: DEPLOYMENT_ID, slot: SLOT }),
    ).pipe(Effect.either, Effect.provide(services));
    const kept = Effect.all({
      stamp: fs.exists(paths.stampPath),
      snapshot: fs.exists(paths.directory),
    });
    function blockedByStorage({
      operation,
      staged,
    }: {
      operation: 'boot' | 'wake';
      staged: boolean;
    }) {
      return Effect.gen(function* () {
        if (staged) {
          const configFile = appZerofsPaths({ appId: APP_ID, stateDir }).configFile;
          yield* fs.makeDirectory(dirname(configFile), { recursive: true });
        }
        const cache = yield* DesiredStateCache;
        yield* cache.accept(
          desiredState({ volumes: [desiredVolume({ storage: staged ? undefined : s3Storage() })] }),
        );
        const vms = yield* VmManager;
        return yield* operation === 'boot'
          ? vms.boot({ desired: desiredInstance(), slot: SLOT, dataDevicePath: SLOT.nbdDevicePath })
          : vms.wake({ appId: APP_ID, deploymentId: DEPLOYMENT_ID, slot: SLOT });
      }).pipe(Effect.either, Effect.provide(services));
    }
    function blockedByVmUnit(operation: 'boot' | 'wake') {
      return Effect.gen(function* () {
        storage.ready = true;
        yield* (yield* DesiredStateCache).accept(
          desiredState({ volumes: [desiredVolume({ storage: s3Storage() })] }),
        );
        yield* (yield* ZerofsTopology).registerAppFilesystem({
          appId: APP_ID,
          filesystem,
          storage: s3Storage(),
        });
        const vms = yield* VmManager;
        return yield* operation === 'boot'
          ? vms.boot({ desired: desiredInstance(), slot: SLOT, dataDevicePath: SLOT.nbdDevicePath })
          : vms.wake({ appId: APP_ID, deploymentId: DEPLOYMENT_ID, slot: SLOT });
      }).pipe(Effect.either, Effect.provide(services));
    }
    return {
      blockedByVmUnit,
      blockedByStorage,
      wake,
      kept,
      commands: systemctl.commands,
      imageHost,
      paths,
      socketPath: Systemd.vmApiSocketPath({ runtimeDir, appId: APP_ID }),
      sleep: Effect.flatMap(VmManager, (vms) =>
        vms.sleep({ appId: APP_ID, deploymentId: DEPLOYMENT_ID, slot: SLOT }),
      ).pipe(Effect.either, Effect.provide(services)),
    };
  });
}

/**
 * `resumeInstance` falls back to a cold boot on `SnapshotUnusable` and on nothing else, so a
 * start that fails past the stamp check is recoverable only if it leaves nothing loadable behind.
 */
describe('a wake whose unit systemd would not start', () => {
  test('a legacy snapshot cannot restore even when its version stamp matches', () =>
    run(
      Effect.gen(function* () {
        const host = yield* hostAsleepAndRefusing();
        const { guestRootfsPath: _rootfs, ...legacy } = stamp;
        yield* writeJsonFile({ path: host.paths.stampPath, value: legacy });
        const outcome = yield* host.wake;
        expect(Either.isLeft(outcome) && outcome.left._tag).toBe('SnapshotUnusable');
        expect(host.commands).toEqual([]);
        expect(yield* host.kept).toEqual({ stamp: false, snapshot: false });
      }),
    ));

  test('an adoption invalidates an old-image snapshot before starting Firecracker', () =>
    run(
      Effect.gen(function* () {
        const host = yield* hostAsleepAndRefusing();
        yield* host.imageHost.activate('image-new');
        const outcome = yield* host.wake;
        expect(Either.isLeft(outcome) && outcome.left._tag).toBe('SnapshotUnusable');
        expect(host.commands).toEqual([]);
      }),
    ));

  test('an unknown running image cannot create a newly mislabelled snapshot', () =>
    run(
      Effect.gen(function* () {
        const host = yield* hostAsleepAndRefusing();
        const outcome = yield* host.sleep;
        expect(Either.isLeft(outcome) && outcome.left._tag).toBe('SleepRefused');
        expect(host.commands).toEqual([]);
      }),
    ));
  test('fails with the start, having asked for nothing after it', async () => {
    const { outcome, commands } = await run(
      Effect.gen(function* () {
        const host = yield* hostAsleepAndRefusing();
        return { outcome: yield* host.wake, commands: host.commands };
      }),
    );

    expect(Either.isLeft(outcome) && outcome.left._tag).toBe('CommandFailed');
    expect(commands.map(({ command }) => command[VERB_ARGUMENT])).toEqual(['start']);
  });

  // The stamp and the files beside it used to outlive this: the snapshot was forgotten only once
  // the start had returned, so the next wake read the same stamp and retried the same start, and
  // the snapshot held its budget against every other app on the host for as long as that went on.
  test('discards the snapshot it could not restore', async () => {
    const kept = await run(
      Effect.gen(function* () {
        const host = yield* hostAsleepAndRefusing();
        yield* host.wake;
        return yield* host.kept;
      }),
    );

    expect(kept).toEqual({ stamp: false, snapshot: false });
  });

  test('leaves the wake after it nothing to restore, which is the cold boot', async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const host = yield* hostAsleepAndRefusing();
        yield* host.wake;
        return yield* host.wake;
      }),
    );

    expect(Either.isLeft(outcome) && outcome.left._tag).toBe('SnapshotUnusable');
  });
});

describe('configured storage gates every VM start', () => {
  test.each(['boot', 'wake'] as const)(
    'an unavailable isolated VM unit blocks %s before altering its snapshot',
    async (operation) => {
      await run(
        Effect.gen(function* () {
          const stage = yield* hostAsleepAndRefusing();
          const result = yield* stage.blockedByVmUnit(operation);
          expect(Either.isLeft(result) && result.left._tag).toBe('VmStorageUnitUnavailable');
          expect(stage.commands.map(({ command }) => command[0])).toEqual(['dd']);
          expect(yield* stage.kept).toEqual({ stamp: true, snapshot: true });
        }),
      );
    },
  );
  test.each([
    { operation: 'boot', staged: false },
    { operation: 'wake', staged: false },
    { operation: 'boot', staged: true },
    { operation: 'wake', staged: true },
  ] as const)(
    'an unavailable or omitted storage backend blocks the VM start: %j',
    async (options) => {
      await run(
        Effect.gen(function* () {
          const stage = yield* hostAsleepAndRefusing();
          const result = yield* stage.blockedByStorage(options);
          expect(Either.isLeft(result) && result.left._tag).toBe(
            options.staged ? 'VolumeStorageConflict' : 'AppZerofsFilesystemUnavailable',
          );
          expect(stage.commands).toEqual([]);
          expect(yield* stage.kept).toEqual({ stamp: true, snapshot: true });
        }),
      );
    },
  );
});

test('a cold boot pins paths and refuses capture after a subsequent image adoption', () =>
  run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const imageHost = yield* installedGuestImage(versions.guestImage);
      const vmDir = yield* temporaryDirectory;
      const runtimeDir = yield* temporaryDirectory;
      const snapshotDir = yield* temporaryDirectory;
      const configImageArgument = 2;
      const commands = recordingCommands(({ command }) => {
        const imagePath = command[configImageArgument];
        if (command[0] === 'mksquashfs' && imagePath !== undefined) {
          return Effect.promise(async () => {
            await Bun.write(imagePath, 'config image');
            return { code: 0, stdout: '', stderr: '' };
          });
        }
        return succeeding({ stdout: command[0] === 'ip' && command[1] === '-json' ? '[]' : '' });
      });
      const host = Layer.mergeAll(
        agentConfig({
          vmDir,
          runtimeDir,
          vmSnapshotDir: snapshotDir,
          versionsFile: imageHost.versionsFile,
          guestImageDir: imageHost.guestImageDir,
        }),
        commands.layer,
      );
      const services = VmManager.DefaultWithoutDependencies.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            AgentState.Default,
            Layer.succeed(
              ArtifactImages,
              ArtifactImages.make({ ensure: () => Effect.succeed('/images/artifact.squashfs') }),
            ),
            Layer.succeed(
              TenantLogReceiver,
              TenantLogReceiver.make({ attach: () => Effect.void, detach: () => Effect.void }),
            ),
            Layer.succeed(
              CronRegistrationReceiver,
              CronRegistrationReceiver.make({
                attach: () => Effect.void,
                detach: () => Effect.void,
              }),
            ),
            ZerofsTopology.DefaultWithoutDependencies,
            DesiredStateCache.DefaultWithoutDependencies,
          ),
        ),
        Layer.provideMerge(host),
      );
      yield* Effect.gen(function* () {
        const vms = yield* VmManager;
        yield* AgentState.putRecord(instanceRecord());
        yield* vms.boot({
          desired: desiredInstance(),
          slot: SLOT,
          dataDevicePath: SLOT.nbdDevicePath,
        });
        const staged = JSON.parse(
          yield* fs.readFileString(`${vms.workingDir(APP_ID)}/firecracker.json`),
        ) as FirecrackerConfig;
        expect(staged['boot-source'].kernel_image_path).toBe(imageHost.image.kernelPath);
        expect(staged.drives.find((drive) => drive.is_root_device)?.path_on_host).toBe(
          imageHost.image.rootfsPath,
        );
        const received = yield* servingFirecracker({
          socketPath: Systemd.vmApiSocketPath({ runtimeDir, appId: APP_ID }),
          configuration: staged,
          fault: undefined,
        });
        yield* imageHost.activate('image-new');
        const sleep = yield* vms
          .sleep({ appId: APP_ID, deploymentId: DEPLOYMENT_ID, slot: SLOT })
          .pipe(Effect.either);
        expect(Either.isLeft(sleep) && sleep.left._tag).toBe('SleepRefused');
        expect(Either.isLeft(sleep) && sleep.left.message).toContain('old or unpinned');
        expect(received.map((call) => call.method)).toEqual(['GET']);
      }).pipe(Effect.provide(services));
    }),
  ));

test('a legacy running VM cannot be identified by resolving its movable rootfs symlink', () =>
  run(
    Effect.gen(function* () {
      const host = yield* hostAsleepAndRefusing();
      yield* host.imageHost.activate('image-new');
      const received = yield* servingFirecracker({
        socketPath: host.socketPath,
        fault: undefined,
        configuration: {
          drives: [
            {
              drive_id: 'rootfs',
              is_root_device: true,
              is_read_only: true,
              path_on_host: `${host.imageHost.guestImageDir}/rootfs.ext4`,
            },
          ],
        },
      });
      const outcome = yield* host.sleep;
      expect(Either.isLeft(outcome) && outcome.left._tag).toBe('SleepRefused');
      expect(Either.isLeft(outcome) && outcome.left.message).toContain('old or unpinned');
      expect(received.map((call) => call.method)).toEqual(['GET']);
      expect(host.commands).toEqual([]);
      expect(yield* host.kept).toEqual({ stamp: true, snapshot: true });
    }),
  ));

test('an unreadable running configuration leaves the VM and saved files untouched', () =>
  run(
    Effect.gen(function* () {
      const host = yield* hostAsleepAndRefusing();
      const received = yield* servingFirecracker({
        socketPath: host.socketPath,
        configuration: undefined,
        fault: 'Cannot read VM configuration',
      });
      const outcome = yield* host.sleep;
      expect(Either.isLeft(outcome) && outcome.left._tag).toBe('SleepRefused');
      expect(received.map((call) => call.method)).toEqual(['GET']);
      expect(host.commands).toEqual([]);
      expect(yield* host.kept).toEqual({ stamp: true, snapshot: true });
    }),
  ));
