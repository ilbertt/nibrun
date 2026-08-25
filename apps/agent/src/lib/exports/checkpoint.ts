import type { AppId, ExportId } from '@repo/protocol';
import { type CheckpointId, CheckpointIdSchema, Value } from '@repo/protocol';
import { Effect } from 'effect';
import { frozen } from '#lib/exports/freeze.ts';
import {
  createCheckpoint,
  deleteCheckpoint,
  listCheckpoints,
  type ZerofsAdmin,
} from '#lib/volumes/zerofs.ts';

/**
 * An export's checkpoint is named after the export, so an orphan says who owned it without
 * anything having written that down. That is what a state-driven reap needs: an agent killed
 * between cutting one and deleting it comes back to a list of names it can recognise, and
 * retrying is the same code path as the first attempt rather than a recovery mode beside it.
 */
const EXPORT_PREFIX = 'export-';

export function exportCheckpointId(exportId: ExportId): CheckpointId {
  return Value.Parse(CheckpointIdSchema, `${EXPORT_PREFIX}${exportId}`);
}

function isExportCheckpoint(name: string): name is CheckpointId {
  return name.startsWith(EXPORT_PREFIX) && Value.Check(CheckpointIdSchema, name);
}

/** Checkpoints on this host an export owns, whether or not this process is the one that cut them. */
export const exportCheckpoints = Effect.fn('exportCheckpoints')((target: ZerofsAdmin) =>
  Effect.map(listCheckpoints(target), (names) => names.filter(isExportCheckpoint)),
);

/**
 * Logged rather than raised: whoever is releasing a checkpoint is on their way out of something
 * else, and failing here would replace that outcome with this one. Loud, because until it goes
 * ZeroFS is reclaiming nothing for anybody on this host.
 */
export const releaseCheckpoint = Effect.fn('releaseCheckpoint')(
  ({ target, checkpointId }: { target: ZerofsAdmin; checkpointId: CheckpointId }) =>
    deleteCheckpoint({ target, checkpointId }).pipe(
      Effect.tapError((error) =>
        Effect.logError(
          'export checkpoint not deleted; storage reclamation stays paused',
          error,
        ).pipe(Effect.annotateLogs({ checkpointId })),
      ),
      Effect.ignore,
    ),
);

/**
 * The whole of what a frozen tenant pays for, and the order inside it is the guarantee.
 *
 * The freeze comes first because only the guest's kernel can checkpoint the ext4 journal, which
 * `debugfs` never replays — an unfrozen filesystem is missing recent metadata however durable the
 * storage under it is. Then the checkpoint, which is the step that captures *now*: cut across a
 * thaw it would be both stale and internally inconsistent, so it is inside this scope and there
 * is no arrangement of this function in which it is outside. Then `assertHeld`, which asks
 * whether the guest was still frozen when the cut was recorded — the same question the export
 * used to ask about the whole read, over a window short enough to answer yes.
 *
 * No `flush` before the checkpoint. `checkpoint create` seals the open data segment and flushes
 * the metadata memtable through the very same flush coordinator the admin `flush` RPC drives
 * (ZeroFS v2.2.1, `CheckpointManager::create_checkpoint`), so a flush here would be a second
 * round trip against a barrier the next call takes anyway — inside the one window where the
 * tenant cannot write. It is load-bearing rather than belt-and-braces: with `ignore_fsync` that
 * barrier is the entire durability guarantee, so a ZeroFS bump that moved it would silently cost
 * the export every write since the last periodic flush, and is the thing to re-check.
 */
export const cutCheckpoint = Effect.fn('cutCheckpoint')(function* ({
  appId,
  vmDir,
  target,
  checkpointId,
}: {
  appId: AppId;
  vmDir: string;
  target: ZerofsAdmin;
  checkpointId: CheckpointId;
}) {
  yield* Effect.annotateCurrentSpan({ checkpointId });
  yield* Effect.scoped(
    Effect.gen(function* () {
      const lease = yield* frozen({ appId, vmDir });
      yield* createCheckpoint({ target, checkpointId });
      // Handed straight back if the guest let go, rather than left for the reap: a cut nobody can
      // vouch for is useless to the export and still pauses reclamation for the whole host. This
      // is the only way out of here that leaves one behind, which is why the cleanup is here and
      // not around the whole function — everything earlier failed before there was one.
      yield* Effect.tapError(lease.assertHeld, () => releaseCheckpoint({ target, checkpointId }));
    }),
  );
  yield* Effect.logInfo('export checkpoint cut while the tenant was frozen').pipe(
    Effect.annotateLogs({ appId, checkpointId }),
  );
  return checkpointId;
});
