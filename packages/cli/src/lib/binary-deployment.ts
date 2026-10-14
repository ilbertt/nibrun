import { createPublicApiClient } from '@repo/api-client/public';
import type { DeploymentCredentialsContract } from '#lib/deployment-credentials.ts';
import { DeploymentError, deploymentApiRequest } from '#lib/deployment-error.ts';

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
  const created = await deploymentApiRequest({
    response: api.api.apps({ appId: input.appId }).artifacts.post({
      filename: input.filename,
      sizeBytes: input.binary.size,
    }),
    operation: 'request a binary upload',
    rejectionHint: undefined,
  });
  if (!('url' in created)) {
    throw new DeploymentError('The API did not provide a binary upload URL.');
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
      throw new DeploymentError(
        `Binary upload failed (HTTP ${response.status}). No deployment was created. Retry the workflow.`,
      );
    }
  } catch (error) {
    await cancelUpload({ input, artifactId: created.artifactId });
    if (error instanceof DeploymentError) {
      throw error;
    }
    throw new DeploymentError(
      'Binary upload failed: storage could not be reached. No deployment was created. Check network connectivity, then retry.',
    );
  }
  const completionApi = await client(input);
  const completed = await deploymentApiRequest({
    response: completionApi.api
      .apps({ appId: input.appId })
      .artifacts({ artifactId: created.artifactId })
      .patch({ upload: 'complete' }),
    operation: 'confirm the binary upload',
    rejectionHint: undefined,
  });
  if (!completed) {
    throw new DeploymentError('The API did not confirm the completed upload.');
  }
  const deploymentApi = await client(input);
  const deployment = await deploymentApiRequest({
    response: deploymentApi.api
      .apps({ appId: input.appId })
      .deployments.post({ artifactId: completed.id }),
    operation: 'create the deployment',
    rejectionHint: undefined,
  });
  return deployment.id;
}

async function cancelUpload({
  input,
  artifactId,
}: {
  input: DeployBinaryInput;
  artifactId: string;
}): Promise<void> {
  try {
    const api = await client(input);
    await api.api
      .apps({ appId: input.appId })
      .artifacts({ artifactId })
      .patch({ upload: 'failed' });
  } catch {
    return;
  }
}
