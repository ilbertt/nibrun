import { describe, expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import type { HostVersions } from '@repo/protocol';
import { Effect, Either, Layer } from 'effect';
import { writeJsonFile } from '#lib/json-store.ts';
import { describeSlot, FIRST_SLOT } from '#lib/network/slot.ts';
import { type SnapshotStamp, snapshotPaths } from '#lib/vm/snapshot.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { TenantLogReceiver } from '#services/tenant-log-receiver.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { agentConfig } from '#tests/support/config.ts';
import { APP_ID, DEPLOYMENT_ID } from '#tests/support/fixtures.ts';
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
    const versionsFile = `${yield* temporaryDirectory}/versions.json`;
    yield* writeJsonFile({ path: versionsFile, value: versions });
    const paths = snapshotPaths({ snapshotDir, appId: APP_ID });
    yield* fs.makeDirectory(paths.directory, { recursive: true });
    yield* fs.writeFileString(paths.statePath, 'the vmm as it was');
    yield* fs.writeFileString(paths.memoryPath, 'the guest as it was');
    yield* writeJsonFile({ path: paths.stampPath, value: stamp });

    const systemctl = systemctlRefusingStart();
    const host = Layer.mergeAll(
      agentConfig({ vmSnapshotDir: snapshotDir, versionsFile, runtimeDir: RUNTIME_DIR }),
      systemctl.layer,
      hostBooted(HOST_BOOT_ID),
    ).pipe(Layer.provideMerge(platform));
    const services = VmManager.DefaultWithoutDependencies.pipe(
      Layer.provide(
        Layer.mergeAll(
          AgentState.Default,
          TenantLogReceiver.Default,
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
    return { wake, kept, commands: systemctl.commands };
  });
}

/**
 * `resumeInstance` falls back to a cold boot on `SnapshotUnusable` and on nothing else, so a
 * start that fails past the stamp check is recoverable only if it leaves nothing loadable behind.
 */
describe('a wake whose unit systemd would not start', () => {
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
