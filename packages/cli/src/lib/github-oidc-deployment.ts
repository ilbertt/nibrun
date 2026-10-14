import type { InferOptions } from '@parshjs/core';
import { z } from 'zod';
import type { command } from '#commands/run/[command].ts';
import { DEPLOYMENT_APP_ID_FLAG, GITHUB_TRUSTED_OIDC_FLAG, SHARED_OPTIONS } from '#config.ts';
import { deployBinary } from '#lib/binary-deployment.ts';
import { parseCommandLine } from '#lib/command-line.ts';
import { binaryFrom } from '#lib/deploy.ts';
import { DeploymentCredentials } from '#lib/deployment-credentials.ts';
import { UsageError } from '#lib/errors.ts';
import {
  maskGitHubSecret,
  readGitHubOidcRequest,
  requestGitHubIdentityToken,
} from '#lib/github-oidc.ts';
import { defineOutput } from '#lib/output.ts';

const SUPPORTED_OPTIONS = new Set<string>([
  GITHUB_TRUSTED_OIDC_FLAG,
  DEPLOYMENT_APP_ID_FLAG,
  SHARED_OPTIONS.detach.name,
]);

const GitHubOidcDeploymentSchema = z.object({
  appId: z.string(),
  deploymentId: z.string(),
});

export const GITHUB_OIDC_DEPLOYMENT_OUTPUT = defineOutput({
  schema: GitHubOidcDeploymentSchema,
  render: ({ value, out }) => out.success(`Deployment ${value.deploymentId} requested.`),
});

type GitHubOidcDeploymentInput = {
  commandLine: string;
  options: InferOptions<typeof command.options>;
  apiUrl: string;
};

export async function deployWithGitHubOidc({
  commandLine,
  options,
  apiUrl,
}: GitHubOidcDeploymentInput): Promise<z.infer<typeof GitHubOidcDeploymentSchema>> {
  const appId = deploymentAppId(options);
  const { binarySource, args } = parseCommandLine(commandLine);
  if (args.length > 0) {
    throw new UsageError(
      `--${GITHUB_TRUSTED_OIDC_FLAG} deploys a binary using the app startup arguments.`,
    );
  }
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(binarySource)) {
    throw new UsageError(`--${GITHUB_TRUSTED_OIDC_FLAG} requires a compiled file on this machine.`);
  }
  const githubOidc = readGitHubOidcRequest();
  const binary = await binaryFrom({ source: binarySource });
  if ('url' in binary) {
    throw new UsageError(`--${GITHUB_TRUSTED_OIDC_FLAG} requires a compiled file on this machine.`);
  }
  const credentials = new DeploymentCredentials({
    apiUrl,
    appId,
    getIdentityToken: function identityToken(audience) {
      return requestGitHubIdentityToken({ ...githubOidc, audience });
    },
    maskSecret: maskGitHubSecret,
  });
  try {
    const deploymentId = await deployBinary({
      apiUrl,
      appId,
      filename: binary.name,
      binary: binary.body,
      credentials,
      maskSecret: maskGitHubSecret,
    });
    return { appId, deploymentId };
  } catch {
    throw new Error(
      'GitHub trusted deployment failed. Check the trusted workflow, app ID, id-token: write permission, and API availability.',
    );
  }
}

function deploymentAppId(options: GitHubOidcDeploymentInput['options']): string {
  if (!options[DEPLOYMENT_APP_ID_FLAG]) {
    throw new UsageError(
      `--${GITHUB_TRUSTED_OIDC_FLAG} requires --${DEPLOYMENT_APP_ID_FLAG} for an existing app.`,
    );
  }
  if (options.detach === false) {
    throw new UsageError(
      `--${GITHUB_TRUSTED_OIDC_FLAG} returns after deployment creation; --${SHARED_OPTIONS.detach.name}=false is not supported.`,
    );
  }
  for (const [name, value] of Object.entries(options)) {
    if (value !== undefined && !SUPPORTED_OPTIONS.has(name)) {
      throw new UsageError(`--${name} is not supported with --${GITHUB_TRUSTED_OIDC_FLAG}.`);
    }
  }
  return options[DEPLOYMENT_APP_ID_FLAG];
}
