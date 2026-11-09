import { FileSystem, Path } from '@effect/platform';
import type { DesiredExport, ExportId, HostDesiredState, ReportedExport } from '@repo/protocol';
import { Effect, Ref } from 'effect';
import { nowTimestamp } from '#lib/clock.ts';
import type { makeExportUploader } from '#lib/exports/upload.ts';
import { writeNibrunnerExportBundle } from '#lib/nibrunner/export-bundle.ts';
import type { ArtifactStore } from '#services/artifact-store.service.ts';
import type { CommandRunner } from '#services/command-runner.service.ts';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PREPARED_EXPORT_SUFFIX = '.export';

export function nibrunnerExportKey(exportId: ExportId) {
  return `${exportId}${PREPARED_EXPORT_SUFFIX}`;
}

export function nibrunnerExportReports({
  desired,
  reported,
  published,
}: {
  desired: readonly DesiredExport[];
  reported: readonly ReportedExport[];
  published: ReadonlyMap<ExportId, ReportedExport>;
}): ReportedExport[] {
  return desired
    .filter((item) => item.desiredState === 'present')
    .flatMap((item): ReportedExport[] => {
      const written = published.get(item.exportId);
      if (written !== undefined) {
        return [written];
      }
      const native = reported.find((candidate) => candidate.exportId === item.exportId);
      if (native === undefined) {
        return [];
      }
      return native.state === 'ready'
        ? [{ exportId: native.exportId, checkpointId: native.checkpointId, state: 'preparing' }]
        : [native];
    });
}

export const makeNibrunnerExports = Effect.fn('makeNibrunnerExports')(function* ({
  directory,
  artifactBucket,
  upload,
}: {
  directory: string;
  artifactBucket: string;
  upload: (
    input: Parameters<ReturnType<typeof makeExportUploader>['upload']>[0],
  ) => Effect.Effect<void, unknown>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const context = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | ArtifactStore | CommandRunner
  >();
  const completed = yield* Ref.make<ReadonlyMap<ExportId, ReportedExport>>(new Map());
  const gate = yield* Effect.makeSemaphore(1);
  const workspace = path.join(directory, 'bridge');
  yield* fs.makeDirectory(workspace, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  for (const name of yield* fs.readDirectory(workspace)) {
    yield* fs.remove(path.join(workspace, name), { recursive: true, force: true });
  }

  function preparedPath(exportId: ExportId) {
    return path.join(directory, nibrunnerExportKey(exportId));
  }

  function publish({ desired, native }: { desired: DesiredExport; native: ReportedExport }) {
    return Effect.gen(function* () {
      const stagingDir = yield* fs.makeTempDirectoryScoped({
        directory: workspace,
        prefix: 'bundle-',
      });
      const bundle = yield* writeNibrunnerExportBundle({
        preparedDirectory: preparedPath(desired.exportId),
        artifact: desired.artifact,
        artifactBucket,
        stagingDir,
      });
      yield* upload({ bundlePath: bundle.path, objectKey: desired.objectKey });
      yield* Effect.logInfo('nibrunner export published').pipe(
        Effect.annotateLogs({ exportId: desired.exportId, sizeBytes: bundle.sizeBytes }),
      );
      return {
        exportId: desired.exportId,
        checkpointId: native.checkpointId,
        state: 'ready',
        sizeBytes: bundle.sizeBytes,
        readyAt: yield* nowTimestamp,
      } satisfies ReportedExport;
    }).pipe(Effect.scoped);
  }

  function reap(desired: readonly DesiredExport[]) {
    return Effect.gen(function* () {
      const retained = new Set(
        desired
          .filter((item) => item.desiredState === 'present')
          .map((item) => nibrunnerExportKey(item.exportId)),
      );
      for (const name of yield* fs.readDirectory(directory)) {
        if (name.endsWith(PREPARED_EXPORT_SUFFIX) && !retained.has(name)) {
          yield* fs.remove(path.join(directory, name), { recursive: true, force: true });
        }
      }
    });
  }

  function publishReady({
    desired,
    reported,
  }: {
    desired: DesiredExport;
    reported: readonly ReportedExport[];
  }) {
    return Effect.gen(function* () {
      const native = reported.find(
        (item) => item.exportId === desired.exportId && item.state === 'ready',
      );
      if (native === undefined || (yield* Ref.get(completed)).has(desired.exportId)) {
        return;
      }
      const report = yield* publish({ desired, native }).pipe(
        Effect.catchAll(() =>
          Effect.logWarning('nibrunner export publication failed').pipe(
            Effect.annotateLogs({ exportId: desired.exportId }),
            Effect.as({
              exportId: desired.exportId,
              checkpointId: native.checkpointId,
              state: 'failed',
              message: 'The native export could not be published as a nibrun bundle.',
            } satisfies ReportedExport),
          ),
        ),
      );
      yield* Ref.update(completed, (held) => new Map(held).set(desired.exportId, report));
    });
  }

  function sync({
    desired,
    reported,
  }: {
    desired: HostDesiredState;
    reported: readonly ReportedExport[];
  }) {
    return gate
      .withPermits(1)(
        Effect.gen(function* () {
          const held = new Set(
            desired.exports
              .filter((item) => item.desiredState === 'present')
              .map((item) => item.exportId),
          );
          yield* Ref.update(
            completed,
            (current) => new Map([...current].filter(([id]) => held.has(id))),
          );
          yield* reap(desired.exports);
          for (const item of desired.exports) {
            if (item.desiredState === 'present') {
              yield* publishReady({ desired: item, reported });
            }
          }
        }),
      )
      .pipe(Effect.provide(context));
  }

  return {
    sync,
    reports: ({
      desired,
      reported,
    }: {
      desired: readonly DesiredExport[];
      reported: readonly ReportedExport[];
    }) =>
      Ref.get(completed).pipe(
        Effect.map((published) => nibrunnerExportReports({ desired, reported, published })),
      ),
  };
});
