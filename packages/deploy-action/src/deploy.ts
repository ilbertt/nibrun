import { createPublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import type { DeploymentCredentialsContract } from '#credentials.ts';

export type DeployBinaryInput = {
  apiUrl: string;
  appId: string;
  filename: string;
  binary: Blob;
  credentials: DeploymentCredentialsContract;
  maskSecret: (secret: string) => void;
};

async function client(input: DeployBinaryInput) {
  return createPublicApiClient({
    baseUrl: input.apiUrl,
    headers: { authorization: `Bearer ${await input.credentials.accessToken()}` },
  });
}

export async function deployBinary(input: DeployBinaryInput): Promise<string> {
  const api = await client(input);
  const created = unwrap(
    await api.api.apps({ appId: input.appId }).artifacts.post({
      filename: input.filename,
      sizeBytes: input.binary.size,
    }),
  );
  if (!('url' in created)) {
    throw new Error('The API did not provide a binary upload URL.');
  }
  input.maskSecret(created.url);
  try {
    const response = await fetch(created.url, {
      method: 'PUT',
      body: input.binary,
      headers: { 'content-length': String(input.binary.size) },
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`Binary upload failed with HTTP ${response.status}.`);
    }
  } catch {
    const cancellationApi = await client(input);
    await cancellationApi.api
      .apps({ appId: input.appId })
      .artifacts({ artifactId: created.artifactId })
      .patch({ upload: 'failed' });
    throw new Error('Binary upload failed. No deployment was created.');
  }
  const completionApi = await client(input);
  const completed = unwrap(
    await completionApi.api
      .apps({ appId: input.appId })
      .artifacts({ artifactId: created.artifactId })
      .patch({ upload: 'complete' }),
  );
  if (!completed) {
    throw new Error('The API did not confirm the completed upload.');
  }
  const deploymentApi = await client(input);
  const deployment = unwrap(
    await deploymentApi.api
      .apps({ appId: input.appId })
      .deployments.post({ artifactId: completed.id }),
  );
  return deployment.id;
}
