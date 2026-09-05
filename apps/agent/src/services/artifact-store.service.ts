import { Data, Effect } from 'effect';
import { s3Credentials } from '#lib/aws/credentials.ts';
import { describe } from '#lib/failure.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { AwsCredentialProvider } from '#services/aws-credential-provider.service.ts';

export class ArtifactTransferError extends Data.TaggedError('ArtifactTransferError')<{
  readonly cause: unknown;
}> {
  override get message() {
    return `the artifact could not be fetched: ${describe(this.cause)}`;
  }
}

export class ArtifactStore extends Effect.Service<ArtifactStore>()('ArtifactStore', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const credentials = yield* AwsCredentialProvider;
    return {
      // The bucket is named by the caller rather than fixed here: a host pulls binaries from one
      // and seed archives from another, and which it is asking for is the caller's fact.
      open: ({
        bucket,
        objectKey,
      }: {
        bucket: string;
        objectKey: string;
      }): Effect.Effect<ReadableStream<Uint8Array>, ArtifactTransferError> =>
        credentials.resolve.pipe(
          Effect.flatMap((resolved) =>
            Effect.try(
              () =>
                new Bun.S3Client({
                  bucket,
                  region: config.awsRegion,
                  ...s3Credentials(resolved),
                })
                  .file(objectKey)
                  .stream() as ReadableStream<Uint8Array>,
            ),
          ),
          Effect.mapError((cause) => new ArtifactTransferError({ cause })),
        ),
    };
  }),
  dependencies: [AgentConfig.Default, AwsCredentialProvider.Default],
}) {}
