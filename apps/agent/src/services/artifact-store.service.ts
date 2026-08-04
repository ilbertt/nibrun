import { Context, Data, Effect, Layer } from 'effect';
import { s3Credentials } from '#aws/credentials.ts';
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

export class ArtifactStore extends Context.Tag('ArtifactStore')<
  ArtifactStore,
  {
    readonly open: (
      objectKey: string,
    ) => Effect.Effect<ReadableStream<Uint8Array>, ArtifactTransferError>;
  }
>() {}

export const layer = Layer.effect(
  ArtifactStore,
  Effect.gen(function* () {
    const config = yield* AgentConfig;
    const credentials = yield* AwsCredentialProvider;
    return {
      open: (objectKey: string) =>
        credentials.resolve.pipe(
          Effect.flatMap((resolved) =>
            Effect.try(
              () =>
                new Bun.S3Client({
                  bucket: config.artifactBucket,
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
).pipe(Layer.provide([AgentConfig.Default, AwsCredentialProvider.Default]));
