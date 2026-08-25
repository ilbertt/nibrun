import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Deferred, Effect, Exit, Fiber, Layer } from 'effect';
import { UnknownException } from 'effect/Cause';
import type { CommandRequest, CommandResult } from '#lib/exec.ts';
import { EXPORT_READER_DEVICE_PATH } from '#lib/network/slot.ts';
import { ExportManager } from '#services/export-manager.service.ts';
import { ExportUploader } from '#services/export-uploader.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { artifactStore } from '#tests/support/artifacts.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { agentConfig } from '#tests/support/config.ts';
import { APP_ID, desiredExport } from '#tests/support/fixtures.ts';
import { fakeGuest, type GuestBehaviour } from '#tests/support/guest.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const ZEROFS = '/opt/nibrun/bin/zerofs/zerofs';
const ZEROFS_CONFIG = '/etc/zerofs/config.toml';
const SYSTEMCTL = 'systemctl';
const NBD_CLIENT = 'nbd-client';

/** Spelled out rather than derived: what an export has to name on a host, not what the source says. */
const CHECKPOINT = 'export-exp-1';
const UNIT = 'nibrun-zerofs-checkpoint@export-exp-1.service';
const UNRELATED_CHECKPOINT = 'migration-2026-08';
const A_CUT_TAKES = '10 millis';
const DELETE_CHECKPOINT = `${ZEROFS} checkpoint delete -c ${ZEROFS_CONFIG} ${CHECKPOINT}`;

const run = provided(platform);

type Script = {
  readonly guest?: GuestBehaviour;
  readonly checkpoints?: readonly string[];
  readonly emptyDump?: boolean;
  readonly uploadFails?: boolean;
  readonly interrupt?: boolean;
};

/**
 * What a real host would answer each subprocess, plus the two observations the whole ordering
 * rests on: whether the guest was still frozen when the checkpoint was cut, and whether it had
 * thawed by the time the read began.
 */
function answering({
  script,
  guest,
  bundleDir,
  frozenAtCut,
  reachedDump,
}: {
  script: Script;
  guest: { isFrozen: () => boolean; thawed: Promise<void> };
  bundleDir: string;
  frozenAtCut: boolean[];
  reachedDump: Deferred.Deferred<void>;
}) {
  const dataDir = join(bundleDir, 'data');
  return ({ command }: CommandRequest): Effect.Effect<CommandResult> =>
    Effect.gen(function* () {
      const [executable, ...args] = command;
      if (executable === ZEROFS && args[0] === 'checkpoint' && args[1] === 'create') {
        frozenAtCut.push(guest.isFrozen());
        // A real cut is a subprocess that seals a segment and uploads it. Answering instantly
        // would leave no turn in which a guest that has already hung up could be noticed, so the
        // lease check afterwards would pass on speed rather than on the freeze holding.
        yield* Effect.sleep(A_CUT_TAKES);
      }
      if (executable === ZEROFS && args[0] === 'checkpoint' && args[1] === 'list') {
        return yield* succeeding({ stdout: (script.checkpoints ?? []).join('\n') });
      }
      if (executable === SYSTEMCTL && args[0] === 'start') {
        // The proof that the read waits for nobody: nothing but the freeze scope ending resolves
        // this, so a freeze still held here hangs the test instead of letting it pass on an
        // ordering that merely happened to hold.
        yield* Effect.promise(() => guest.thawed);
      }
      if (executable === 'debugfs') {
        yield* Deferred.succeed(reachedDump, undefined);
        if (script.interrupt) {
          return yield* Effect.never;
        }
        if (!script.emptyDump) {
          // `lost+found` is written by mkfs.ext4, so a real rdump of any root produces it.
          yield* Effect.promise(() => mkdir(join(dataDir, 'lost+found'), { recursive: true }));
          yield* Effect.promise(() => writeFile(join(dataDir, 'data.db'), 'tenant'));
        }
      }
      if (executable === 'tar') {
        yield* Effect.promise(() => writeFile(join(bundleDir, 'bundle.tar.gz'), 'archive'));
      }
      return yield* succeeding();
    });
}

const staged = (script: Script) =>
  Effect.gen(function* () {
    const stateDir = yield* temporaryDirectory;
    const vmDir = join(stateDir, 'vm');
    const exportStagingDir = join(stateDir, 'exports');
    const desired = desiredExport();
    const guest = yield* fakeGuest({ vmDir, appId: APP_ID, behaviour: script.guest });
    const frozenAtCut: boolean[] = [];
    const reachedDump = yield* Deferred.make<void>();
    const uploads: { objectKey: string; commandsSoFar: number }[] = [];

    const { commands, layer: commandLayer } = recordingCommands(
      answering({
        script,
        guest,
        bundleDir: join(exportStagingDir, desired.exportId),
        frozenAtCut,
        reachedDump,
      }),
    );

    const uploader = Layer.succeed(
      ExportUploader,
      ExportUploader.make({
        upload: ({ objectKey }) => {
          uploads.push({ objectKey, commandsSoFar: commands.length });
          return script.uploadFails
            ? Effect.fail(new UnknownException(new Error('the bucket refused the bundle')))
            : Effect.void;
        },
      }),
    );

    const support = Layer.mergeAll(
      agentConfig({ vmDir, exportStagingDir }),
      uploader,
      commandLayer,
      artifactStore(),
      platform,
    );

    return {
      desired,
      exportStagingDir,
      frozenAtCut,
      uploads,
      reachedDump,
      lines: () => commands.map(({ command }) => command.join(' ')),
      layers: Layer.provideMerge(
        ExportManager.DefaultWithoutDependencies,
        Layer.provideMerge(ZerofsTopology.DefaultWithoutDependencies, support),
      ),
    };
  });

function exporting(script: Script = {}) {
  return Effect.gen(function* () {
    const stage = yield* staged(script);
    const result = yield* Effect.provide(
      Effect.gen(function* () {
        const exports = yield* ExportManager;
        const writing = exports.write({ desired: stage.desired });
        if (!script.interrupt) {
          return yield* Effect.exit(writing);
        }
        const fiber = yield* Effect.fork(writing);
        yield* Deferred.await(stage.reachedDump);
        return yield* Fiber.interrupt(fiber);
      }),
      stage.layers,
    );
    return { ...stage, result, lines: stage.lines() };
  });
}

function reaping(script: Script = {}) {
  return Effect.gen(function* () {
    const stage = yield* staged(script);
    yield* Effect.provide(
      Effect.flatMap(ExportManager, (exports) => exports.reap),
      stage.layers,
    );
    return { ...stage, lines: stage.lines() };
  });
}

const at = ({ lines, needle }: { lines: readonly string[]; needle: string }) =>
  lines.findIndex((line) => line.includes(needle));

describe('an export reads a checkpoint rather than the tenant device', () => {
  test('cuts the checkpoint while the guest is frozen and reads once it has thawed', async () => {
    const { frozenAtCut, lines, result } = await run(exporting());

    expect(Exit.isSuccess(result)).toBe(true);
    expect(frozenAtCut).toEqual([true]);
    const cut = at({ lines, needle: 'checkpoint create' });
    expect(cut).toBeGreaterThanOrEqual(0);
    expect(at({ lines, needle: `${SYSTEMCTL} start ${UNIT}` })).toBeGreaterThan(cut);
    expect(at({ lines, needle: `${NBD_CLIENT} -unix` })).toBeGreaterThan(cut);
    expect(at({ lines, needle: 'debugfs' })).toBeGreaterThan(cut);
  });

  // ZeroFS seals the open segment and flushes the metadata memtable through the same coordinator
  // the admin RPC drives before it records a checkpoint, so a flush here would be a second round
  // trip against that barrier — inside the one window where the tenant cannot write.
  test('asks for no flush of its own, because the cut takes that barrier', async () => {
    const { lines } = await run(exporting());

    expect(lines.some((line) => line.includes(`${ZEROFS} flush`))).toBe(false);
  });

  test('attaches the checkpoint to the device held back for reading one', async () => {
    const { lines } = await run(exporting());

    const attach = lines.find((line) => line.includes(`${NBD_CLIENT} -unix`));
    expect(attach).toContain(EXPORT_READER_DEVICE_PATH);
    expect(attach).toContain(`/run/zerofs-checkpoint/${CHECKPOINT}/nbd.sock`);
    // The live server's socket is the one thing this must not open.
    expect(attach).not.toContain('/run/zerofs/nbd.sock');
    // A checkpoint server is read-only whatever this side asks for, and reconnecting forever to
    // one that has been stopped is not what a finished export wants.
    expect(attach).not.toContain('-persist');
  });

  test('names the checkpoint after the export it belongs to', async () => {
    const { lines } = await run(exporting());

    expect(lines).toContain(`${ZEROFS} checkpoint create -c ${ZEROFS_CONFIG} ${CHECKPOINT}`);
  });
});

describe('a freeze that did not survive the cut', () => {
  test('fails the export and uploads nothing', async () => {
    const { result, uploads, lines } = await run(
      exporting({ guest: { hangUpAfterFreezing: true } }),
    );

    expect(Exit.isFailure(result)).toBe(true);
    expect(uploads).toEqual([]);
    expect(lines.some((line) => line.includes('debugfs'))).toBe(false);
  });

  // Useless to the export and still a pause on the whole host's storage reclamation, so it goes
  // back at once rather than waiting for a reap.
  test('hands the checkpoint straight back', async () => {
    const { lines } = await run(exporting({ guest: { hangUpAfterFreezing: true } }));

    expect(lines).toContain(DELETE_CHECKPOINT);
  });
});

describe('what an export leaves behind', () => {
  const tornDown = (lines: readonly string[]) => ({
    device: lines.includes(`${NBD_CLIENT} -d ${EXPORT_READER_DEVICE_PATH}`),
    server: lines.includes(`${SYSTEMCTL} stop ${UNIT}`),
    checkpoint: lines.includes(DELETE_CHECKPOINT),
  });

  const ALL_GONE = { device: true, server: true, checkpoint: true };

  test('nothing, on the way out of an export that worked', async () => {
    const { result, lines, uploads, exportStagingDir } = await run(exporting());

    expect(Exit.isSuccess(result)).toBe(true);
    expect(tornDown(lines)).toEqual(ALL_GONE);
    expect(existsSync(exportStagingDir)).toBe(false);
    // Released as soon as the bytes are staged: the archive and the upload need nothing from it,
    // and every second it is held is a second this host reclaims nothing for anybody.
    expect(uploads[0]?.commandsSoFar).toBeGreaterThan(at({ lines, needle: 'checkpoint delete' }));
  });

  test('nothing, when the dump produced no files', async () => {
    const { result, lines, uploads, exportStagingDir } = await run(exporting({ emptyDump: true }));

    expect(Exit.isFailure(result)).toBe(true);
    expect(uploads).toEqual([]);
    expect(tornDown(lines)).toEqual(ALL_GONE);
    expect(existsSync(exportStagingDir)).toBe(false);
  });

  test('nothing, when the bucket refused the bundle', async () => {
    const { result, lines, uploads, exportStagingDir } = await run(
      exporting({ uploadFails: true }),
    );

    expect(Exit.isFailure(result)).toBe(true);
    expect(uploads).toHaveLength(1);
    expect(tornDown(lines)).toEqual(ALL_GONE);
    expect(existsSync(exportStagingDir)).toBe(false);
  });

  test('nothing, when the agent is stopped mid-read', async () => {
    const { result, lines, exportStagingDir } = await run(exporting({ interrupt: true }));

    expect(Exit.isInterrupted(result)).toBe(true);
    expect(tornDown(lines)).toEqual(ALL_GONE);
    expect(existsSync(exportStagingDir)).toBe(false);
  });
});

/**
 * The case a finaliser cannot reach: an agent killed between cutting a checkpoint and deleting it
 * leaves one nothing in this process has ever heard of, and while it exists ZeroFS reclaims
 * nothing for any tenant on the host.
 */
describe('checkpoints an earlier agent left behind', () => {
  test('are reaped from what ZeroFS says exists, with no record of them here', async () => {
    const { lines } = await run(reaping({ checkpoints: [CHECKPOINT] }));

    expect(lines).toContain(DELETE_CHECKPOINT);
    expect(lines).toContain(`${SYSTEMCTL} stop ${UNIT}`);
    expect(lines).toContain(`${NBD_CLIENT} -d ${EXPORT_READER_DEVICE_PATH}`);
  });

  // A checkpoint somebody asked for through desired state is not an export's to remove, and the
  // name is the only thing that says which is which.
  test("leave a checkpoint that is not an export's alone", async () => {
    const { lines } = await run(reaping({ checkpoints: [UNRELATED_CHECKPOINT] }));

    expect(lines.some((line) => line.includes('checkpoint delete'))).toBe(false);
    expect(lines.some((line) => line.includes(`${SYSTEMCTL} stop`))).toBe(false);
  });

  test('cost nothing but the listing when there are none', async () => {
    const { lines } = await run(reaping());

    expect(lines).toEqual([`${ZEROFS} checkpoint list -c ${ZEROFS_CONFIG}`]);
  });
});
