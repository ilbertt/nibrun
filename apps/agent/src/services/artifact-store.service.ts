import { Effect } from 'effect';
import { makeArtifactStore } from '#lib/artifacts/store.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { AwsCredentialProvider } from '#services/aws-credential-provider.service.ts';

export class ArtifactStore extends Effect.Service<ArtifactStore>()('ArtifactStore', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const credentials = yield* AwsCredentialProvider;
    return makeArtifactStore({ region: config.awsRegion, credentials: credentials.resolve });
  }),
  dependencies: [AgentConfig.Default, AwsCredentialProvider.Default],
}) {}
