import { describe, expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import type { HostVersions } from '@repo/protocol';
import { Effect, Either, Layer, Option } from 'effect';
import { writeJsonFile } from '#lib/json-store.ts';
import { describeSlot, FIRST_SLOT } from '#lib/network/slot.ts';
import type { FirecrackerConfig } from '#lib/vm/firecracker-config.ts';
import { readBootedGuestImage } from '#lib/vm/guest-image.ts';
import { type SnapshotStamp, snapshotPaths } from '#lib/vm/snapshot.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { ArtifactImages } from '#services/artifact-images.service.ts';
import { ArtifactTransferError } from '#services/artifact-store.service.ts';
import { CronRegistrationReceiver } from '#services/cron-registration-receiver.service.ts';
import { TenantLogReceiver } from '#services/tenant-log-receiver.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { agentConfig } from '#tests/support/config.ts';
import { APP_ID, DEPLOYMENT_ID, desiredInstance, instanceRecord } from '#tests/support/fixtures.ts';
import { installedGuestImage } from '#tests/support/guest-image.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);

const RUNTIME_DIR = '/nonexistent/nibrun-test/run';
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

function hostBooted(bootId: string) {
  return Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (fs) => ({
      ...fs,
      readFileString: (...read: Parameters<FileSystem.FileSystem['readFileString']>) => {
        const [path] = read;
        return path === HOST_BOOT_ID_PATH ? Effect.succeed(bootId) : fs.readFileString(...read);
      },
    })),
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
        vmSnapshotDir: snapshotDir,
        vmDir: yield* temporaryDirectory,
        versionsFile: imageHost.versionsFile,
        guestImageDir: imageHost.guestImageDir,
        runtimeDir: RUNTIME_DIR,
      }),
      systemctl.layer,
      hostBooted(HOST_BOOT_ID),
    ).pipe(Layer.provideMerge(platform));
    const services = VmManager.DefaultWithoutDependencies.pipe(
      Layer.provide(
        Layer.mergeAll(
          AgentState.Default,
          noArtifactImages,
          TenantLogReceiver.Default,
          Layer.succeed(
            CronRegistrationReceiver,
            CronRegistrationReceiver.make({ attach: () => Effect.void, detach: () => Effect.void }),
          ),
          ZerofsTopology.DefaultWithoutDependencies,
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
    return {
      wake,
      kept,
      commands: systemctl.commands,
      imageHost,
      paths,
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

test('a cold boot pins its configuration and identity to the image actually started', () =>
  run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const imageHost = yield* installedGuestImage(versions.guestImage);
      const vmDir = yield* temporaryDirectory;
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
        const booted = yield* readBootedGuestImage(vms.workingDir(APP_ID));
        expect(booted).toEqual(Option.some({ ...imageHost.image, deploymentId: DEPLOYMENT_ID }));
        expect((yield* AgentState.snapshot).records.get(APP_ID)?.guestImageVersion).toBe(
          versions.guestImage,
        );
        const staged = JSON.parse(
          yield* fs.readFileString(`${vms.workingDir(APP_ID)}/firecracker.json`),
        ) as FirecrackerConfig;
        expect(staged['boot-source'].kernel_image_path).toBe(imageHost.image.kernelPath);
        expect(staged.drives.find((drive) => drive.is_root_device)?.path_on_host).toBe(
          imageHost.image.rootfsPath,
        );
        yield* imageHost.activate('image-new');
        expect(yield* readBootedGuestImage(vms.workingDir(APP_ID))).toEqual(booted);
        const sleep = yield* vms
          .sleep({ appId: APP_ID, deploymentId: DEPLOYMENT_ID, slot: SLOT })
          .pipe(Effect.either);
        expect(Either.isLeft(sleep) && sleep.left._tag).toBe('SleepRefused');
      }).pipe(Effect.provide(services));
    }),
  ));
