import { FileSystem, Path } from '@effect/platform';
import type { DesiredExport, ReportedExport } from '@repo/protocol';
import { Effect } from 'effect';
import { nowTimestamp } from '#lib/clock.ts';
import { dumpVolume, writeBundle } from '#lib/exports/bundle.ts';
import {
  cutCheckpoint,
  exportCheckpointId,
  exportCheckpoints,
  releaseCheckpoint,
} from '#lib/exports/checkpoint.ts';
import { attachedCheckpoint, detachReader, stopCheckpointServer } from '#lib/exports/reader.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { ExportUploader } from '#services/export-uploader.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

/**
 * One, because `EXPORT_READER_DEVICE_PATH` is one device: a second export attaching a second
 * checkpoint to it would read the first export's filesystem. So one export reads at a time on a
 * host, and that is what bounds them. Held rather than assumed — the reconcile loop happens to
 * run exports one at a time, and an export must not silently depend on that staying true.
 */
const READER_PERMITS = 1;

export class ExportManager extends Effect.Service<ExportManager>()('ExportManager', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const topology = yield* ZerofsTopology;
    const filesystem = topology.place();
    const uploader = yield* ExportUploader;
    const reader = yield* Effect.makeSemaphore(READER_PERMITS);

    /**
     * Cleanup that does not depend on this process having made the mess. Ending the scope covers
     * the export that failed; nothing in-process covers an agent killed between cutting a
     * checkpoint and deleting it, and that is the case worth covering — while any checkpoint
     * exists ZeroFS pauses segment deletion, compaction and metadata reclamation for *every*
     * tenant on the host. So the work is derived from what ZeroFS says exists, which is what
     * makes retrying it the same code path as doing it the first time.
     *
     * The list costs a round trip on every reconcile, and unlike `applyCheckpoints` there is no
     * desired state to skip it on: an orphan is precisely a checkpoint nothing asked for.
     *
     * Under the reader's permit, so "every export checkpoint on this host" can never name one a
     * live export is still reading.
     */
    const reap = reader
      .withPermits(READER_PERMITS)(
        Effect.gen(function* () {
          // A staging tree outlives a SIGKILL for the same reason a checkpoint does, and it is a
          // tenant's whole dataset in the clear on a shared host.
          yield* fs
            .remove(config.exportStagingDir, { recursive: true, force: true })
            .pipe(Effect.ignore);
          const orphans = yield* exportCheckpoints(filesystem.admin);
          if (orphans.length === 0) {
            return;
          }
          yield* detachReader;
          yield* Effect.forEach(
            orphans,
            (checkpointId) =>
              stopCheckpointServer(checkpointId).pipe(
                Effect.andThen(releaseCheckpoint({ target: filesystem.admin, checkpointId })),
              ),
            { discard: true },
          );
          yield* Effect.logWarning('export checkpoints left behind were reaped').pipe(
            Effect.annotateLogs({ checkpoints: orphans.length }),
          );
        }),
      )
      .pipe(
        Effect.catchAll((error) =>
          Effect.logError('export checkpoints could not be reaped', error),
        ),
        Effect.withSpan('ExportManager.reap'),
      );

    /**
     * The freeze is over before the read begins. The tenant is held still only long enough to cut
     * a checkpoint; the `rdump`, the archive and the upload — everything whose cost scales with
     * their data — run against that pinned view while they are writing again. The bundle is of
     * the same moment it always was, because the checkpoint is cut inside the freeze.
     *
     * The checkpoint is released as soon as the bytes are in the staging tree rather than held to
     * the end: nothing after the dump reads it, and holding it costs the whole host its storage
     * reclamation. The staging tree goes whether or not the upload worked, because it is a second
     * copy of a tenant's dataset in the clear on a shared host.
     */
    const write = Effect.fn('ExportManager.write')(function* ({
      desired,
    }: {
      desired: DesiredExport;
    }) {
      yield* Effect.annotateCurrentSpan({ exportId: desired.exportId });
      const stagingDir = path.join(config.exportStagingDir, desired.exportId);
      const checkpointId = exportCheckpointId(desired.exportId);

      return yield* Effect.ensuring(
        Effect.gen(function* () {
          yield* reader.withPermits(READER_PERMITS)(
            Effect.scoped(
              Effect.gen(function* () {
                yield* Effect.acquireRelease(
                  cutCheckpoint({
                    appId: desired.appId,
                    vmDir: config.vmDir,
                    target: filesystem.admin,
                    checkpointId,
                  }),
                  () => releaseCheckpoint({ target: filesystem.admin, checkpointId }),
                );
                const devicePath = yield* attachedCheckpoint({
                  filesystem,
                  checkpointId,
                  volumeId: desired.volumeId,
                });
                yield* dumpVolume({ devicePath, stagingDir });
              }),
            ),
          );
          const bundle = yield* writeBundle({
            artifact: desired.artifact,
            environment: desired.environment,
            stagingDir,
          });
          yield* uploader.upload({ bundlePath: bundle.path, objectKey: desired.objectKey });
          yield* Effect.logInfo('export written').pipe(
            Effect.annotateLogs({
              exportId: desired.exportId,
              objectKey: desired.objectKey,
              sizeBytes: bundle.sizeBytes,
            }),
          );
          return {
            exportId: desired.exportId,
            checkpointId,
            state: 'ready',
            sizeBytes: bundle.sizeBytes,
            readyAt: yield* nowTimestamp,
          } satisfies ReportedExport;
        }),
        fs.remove(stagingDir, { recursive: true, force: true }).pipe(Effect.ignore),
      );
    });

    return { write, reap };
  }),
  dependencies: [AgentConfig.Default, ZerofsTopology.Default, ExportUploader.Default],
}) {}
