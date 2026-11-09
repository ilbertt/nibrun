import { Effect } from 'effect';
import {
  type AwsCredentials,
  type InstanceCredentialsError,
  s3Credentials,
} from '#lib/aws/credentials.ts';

const UPLOAD_PART_SIZE_BYTES = 8_388_608;
const UPLOAD_QUEUE_SIZE = 4;
const UPLOAD_RETRIES = 3;

export function makeExportUploader({
  bucket,
  region,
  credentials,
}: {
  bucket: string;
  region: string;
  credentials: Effect.Effect<AwsCredentials, InstanceCredentialsError>;
}) {
  const upload = Effect.fn('ExportUploader.upload')(function* ({
    bundlePath,
    objectKey,
  }: {
    bundlePath: string;
    objectKey: string;
  }) {
    yield* Effect.annotateCurrentSpan({ objectKey });
    const resolved = yield* credentials;
    const client = new Bun.S3Client({
      bucket,
      region,
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
}
