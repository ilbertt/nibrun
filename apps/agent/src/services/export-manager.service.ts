import { FileSystem, Path } from '@effect/platform';
import type { DesiredArtifact, DesiredExport, ReportedExport } from '@repo/protocol';
import { Effect } from 'effect';
import { s3Credentials } from '#aws/credentials.ts';
import { writeBundle } from '#exports/bundle.ts';
import { nowTimestamp } from '#lib/clock.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { AwsCredentialProvider } from '#services/aws-credential-provider.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { flush } from '#volumes/zerofs.ts';

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
          // Under `ignore_fsync` the guest's barriers are not durability points, so this is what
          // turns its acknowledged writes into bytes the device will hand back.
          yield* flush(topology.place().admin);
          const bundle = yield* writeBundle({ artifact, devicePath, stagingDir });
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
