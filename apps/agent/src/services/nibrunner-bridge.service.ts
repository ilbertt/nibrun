import { Effect } from 'effect';
import { makeArtifactStore } from '#lib/artifacts/store.ts';
import { makeControlPlaneClient } from '#lib/control/client.ts';
import { makeNibrunnerBridge } from '#lib/nibrunner/bridge.ts';
import { ArtifactStore } from '#services/artifact-store.service.ts';
import { AwsCredentialProvider } from '#services/aws-credential-provider.service.ts';
import { NibrunnerBridgeConfig } from '#services/nibrunner-bridge-config.service.ts';

export class NibrunnerBridge extends Effect.Service<NibrunnerBridge>()('NibrunnerBridge', {
  effect: Effect.gen(function* () {
    const config = yield* NibrunnerBridgeConfig;
    const credentials = yield* AwsCredentialProvider;
    return yield* makeNibrunnerBridge({
      config,
      control: makeControlPlaneClient({ baseUrl: config.controlPlaneUrl }),
    }).pipe(
      Effect.provideService(
        ArtifactStore,
        ArtifactStore.make(
          makeArtifactStore({
            region: config.awsRegion,
            credentials: credentials.resolve,
          }),
        ),
      ),
    );
  }),
  dependencies: [NibrunnerBridgeConfig.Default, AwsCredentialProvider.Default],
}) {}
