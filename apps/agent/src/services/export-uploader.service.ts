import { Effect } from 'effect';
import { makeExportUploader } from '#lib/exports/upload.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { AwsCredentialProvider } from '#services/aws-credential-provider.service.ts';

export class ExportUploader extends Effect.Service<ExportUploader>()('ExportUploader', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const credentials = yield* AwsCredentialProvider;
    return makeExportUploader({
      bucket: config.exportBucket,
      region: config.awsRegion,
      credentials: credentials.resolve,
    });
  }),
  dependencies: [AgentConfig.Default, AwsCredentialProvider.Default],
}) {}
