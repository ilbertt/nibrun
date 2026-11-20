import { Effect } from 'effect';
import { makeArtifactStore } from '#lib/artifacts/store.ts';
import { AwsCredentialProvider } from '#services/aws-credential-provider.service.ts';
import { NibrunnerBridgeConfig } from '#services/nibrunner-bridge-config.service.ts';

export class ArtifactStore extends Effect.Service<ArtifactStore>()('ArtifactStore', {
  effect: Effect.gen(function* () {
    const config = yield* NibrunnerBridgeConfig;
    const credentials = yield* AwsCredentialProvider;
    return makeArtifactStore({ region: config.awsRegion, credentials: credentials.resolve });
  }),
  dependencies: [NibrunnerBridgeConfig.Default, AwsCredentialProvider.Default],
}) {}
