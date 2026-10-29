import { Data, Effect } from 'effect';
import {
  type AwsCredentials,
  type InstanceCredentialsError,
  s3Credentials,
} from '#lib/aws/credentials.ts';
import { describe } from '#lib/failure.ts';

export class ArtifactTransferError extends Data.TaggedError('ArtifactTransferError')<{
  readonly cause: unknown;
}> {
  override get message() {
    return `the artifact could not be fetched: ${describe(this.cause)}`;
  }
}

export function makeArtifactStore({
  region,
  credentials,
}: {
  region: string;
  credentials: Effect.Effect<AwsCredentials, InstanceCredentialsError>;
}) {
  return {
    open: ({ bucket, objectKey }: { bucket: string; objectKey: string }) =>
      credentials.pipe(
        Effect.flatMap((resolved) =>
          Effect.try(
            () =>
              new Bun.S3Client({
                bucket,
                region,
                ...s3Credentials(resolved),
              })
                .file(objectKey)
                .stream() as ReadableStream<Uint8Array>,
          ),
        ),
        Effect.mapError((cause) => new ArtifactTransferError({ cause })),
      ),
  };
}
