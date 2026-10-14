import { openAsBlob } from 'node:fs';
import { basename, resolve } from 'node:path';
import { getIDToken, getInput, info, setFailed, setOutput, setSecret } from '@actions/core';
import { DeploymentCredentials } from '#credentials.ts';
import { deployBinary } from '#deploy.ts';

async function run(): Promise<void> {
  const apiUrl = getInput('api-url', { required: true });
  const appId = getInput('app-id', { required: true });
  const path = resolve(getInput('binary', { required: true }));
  const binary = await openAsBlob(path);
  const credentials = new DeploymentCredentials({
    apiUrl,
    appId,
    getIdentityToken: getIDToken,
    maskSecret: setSecret,
  });
  const deploymentId = await deployBinary({
    apiUrl,
    appId,
    filename: basename(path),
    binary,
    credentials,
    maskSecret: setSecret,
  });
  setOutput('deployment-id', deploymentId);
  info(`Deployment ${deploymentId} requested.`);
}

try {
  await run();
} catch {
  setFailed(
    'Deployment failed. Check the trusted workflow, app ID, binary path, and API availability.',
  );
}
