import { Effect } from 'effect';
import { s3Credentials } from '#lib/aws/credentials.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { AwsCredentialProvider } from '#services/aws-credential-provider.service.ts';

const UPLOAD_PART_SIZE_BYTES = 8_388_608;
const UPLOAD_QUEUE_SIZE = 4;
const UPLOAD_RETRIES = 3;

/**
 * The export bucket, and the only thing on this host that writes to it.
 *
 * Apart from `ExportManager` because it is the one step of an export that leaves the box: what it
 * needs is a bucket and a credential, where everything around it needs a frozen guest, a
 * checkpoint and a device. Which also makes it the seam a test stands in front of, so the ordering
 * either side of it can be checked without an S3 endpoint.
 */
export class ExportUploader extends Effect.Service<ExportUploader>()('ExportUploader', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const credentials = yield* AwsCredentialProvider;

    /**
     * Streamed in parts rather than read into memory: a bundle is a tenant's whole dataset. A
     * failure before `end()` leaves the multipart upload uncommitted rather than publishing a
     * truncated bundle, and the bucket's abort rule reaps it — which is why exports need no
     * delete permission.
     */
    const upload = Effect.fn('ExportUploader.upload')(function* ({
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

    return { upload };
  }),
  dependencies: [AgentConfig.Default, AwsCredentialProvider.Default],
}) {}
