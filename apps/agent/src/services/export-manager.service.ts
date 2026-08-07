import { FileSystem, Path } from '@effect/platform';
import type { DesiredArtifact, DesiredExport, ReportedExport } from '@repo/protocol';
import { Effect } from 'effect';
import { s3Credentials } from '#lib/aws/credentials.ts';
import { nowTimestamp } from '#lib/clock.ts';
import { dumpVolume, writeBundle } from '#lib/exports/bundle.ts';
import { frozen } from '#lib/exports/freeze.ts';
import { flush } from '#lib/volumes/zerofs.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { AwsCredentialProvider } from '#services/aws-credential-provider.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

const UPLOAD_PART_SIZE_BYTES = 8_388_608;
const UPLOAD_QUEUE_SIZE = 4;
const UPLOAD_RETRIES = 3;

export class ExportManager extends Effect.Service<ExportManager>()('ExportManager', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const topology = yield* ZerofsTopology;
    const credentials = yield* AwsCredentialProvider;

    /**
     * Streamed in parts rather than read into memory: a bundle is a tenant's whole dataset. A
     * failure before `end()` leaves the multipart upload uncommitted rather than publishing a
     * truncated bundle, and the bucket's abort rule reaps it — which is why exports need no
     * delete permission.
     */
    const upload = Effect.fn('ExportManager.upload')(function* ({
      bundlePath,
      objectKey,
    }: {
      bundlePath: string;
      objectKey: string;
    }) {
      yield* Effect.annotateCurrentSpan({ objectKey });
      const resolved = yield* credentials.resolve;
      const client = new Bun.S3Client({
        bucket: config.exportBucket,
        region: config.awsRegion,
        ...s3Credentials(resolved),
      });
      yield* Effect.tryPromise(async () => {
        const writer = client.file(objectKey).writer({
          partSize: UPLOAD_PART_SIZE_BYTES,
          queueSize: UPLOAD_QUEUE_SIZE,
          retry: UPLOAD_RETRIES,
        });
        for await (const chunk of Bun.file(bundlePath).stream()) {
          writer.write(chunk);
        }
        await writer.end();
      });
    });

    /**
     * The staging tree is a second copy of a tenant's dataset in the clear on a shared host, so
     * it is removed whether or not the upload worked.
     */
    const write = Effect.fn('ExportManager.write')(function* ({
      desired,
      artifact,
      devicePath,
    }: {
      desired: DesiredExport;
      artifact: DesiredArtifact;
      devicePath: string;
    }) {
      yield* Effect.annotateCurrentSpan({ exportId: desired.exportId });
      const stagingDir = path.join(config.exportStagingDir, desired.exportId);
      return yield* Effect.ensuring(
        Effect.gen(function* () {
          // Two layers of staleness sit between a tenant's last write and the device this reads,
          // and each needs the side that owns it to act. The guest's kernel goes first: only it
          // can checkpoint the ext4 journal that `debugfs` never replays, and staying frozen is
          // also what stops the device changing mid-read. Then ZeroFS, where under
          // `ignore_fsync` the guest's barriers are not durability points, so this is what turns
          // acknowledged writes into bytes the device will hand back.
          //
          // The scope ends where the reading does. Archiving what was read needs the tenant no
          // more than uploading it does, and both take longer.
          yield* Effect.scoped(
            Effect.gen(function* () {
              const lease = yield* frozen({ appId: desired.appId, vmDir: config.vmDir });
              yield* flush(topology.place().admin);
              yield* dumpVolume({ devicePath, stagingDir });
              yield* lease.assertHeld;
            }),
          );
          const bundle = yield* writeBundle({ artifact, stagingDir });
          yield* upload({ bundlePath: bundle.path, objectKey: desired.objectKey });
          yield* Effect.logInfo('export written').pipe(
            Effect.annotateLogs({
              exportId: desired.exportId,
              objectKey: desired.objectKey,
              sizeBytes: bundle.sizeBytes,
            }),
          );
          return {
            exportId: desired.exportId,
            state: 'ready',
            sizeBytes: bundle.sizeBytes,
            readyAt: yield* nowTimestamp,
          } satisfies ReportedExport;
        }),
        fs.remove(stagingDir, { recursive: true, force: true }).pipe(Effect.ignore),
      );
    });

    return { write };
  }),
  dependencies: [AgentConfig.Default, ZerofsTopology.Default, AwsCredentialProvider.Default],
}) {}
