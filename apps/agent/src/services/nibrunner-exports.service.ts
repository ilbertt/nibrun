import { Effect } from 'effect';
import { makeArtifactStore } from '#lib/artifacts/store.ts';
import { makeExportUploader } from '#lib/exports/upload.ts';
import { makeNibrunnerExports } from '#lib/nibrunner/exports.ts';
import { ArtifactStore } from '#services/artifact-store.service.ts';
import { AwsCredentialProvider } from '#services/aws-credential-provider.service.ts';
import { CommandRunner } from '#services/command-runner.service.ts';
import { NibrunnerBridgeConfig } from '#services/nibrunner-bridge-config.service.ts';

export class NibrunnerExports extends Effect.Service<NibrunnerExports>()('NibrunnerExports', {
  effect: Effect.gen(function* () {
    const config = yield* NibrunnerBridgeConfig;
    const credentials = yield* AwsCredentialProvider;
    return yield* makeNibrunnerExports({
      directory: config.exportsDirectory,
      artifactBucket: config.artifactBucket,
      upload: makeExportUploader({
        bucket: config.exportBucket,
        region: config.awsRegion,
        credentials: credentials.resolve,
      }).upload,
    }).pipe(
      Effect.provideService(
        ArtifactStore,
        ArtifactStore.make(
          makeArtifactStore({ region: config.awsRegion, credentials: credentials.resolve }),
        ),
      ),
    );
  }),
  dependencies: [
    NibrunnerBridgeConfig.Default,
    AwsCredentialProvider.Default,
    CommandRunner.Default,
  ],
}) {}
