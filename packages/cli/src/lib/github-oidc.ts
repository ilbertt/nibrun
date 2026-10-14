import { createEnvContext } from '@parshjs/env';
import { z } from 'zod';
import { GITHUB_TRUSTED_OIDC_FLAG } from '#config.ts';
import { DeploymentError } from '#lib/deployment-error.ts';
import { UsageError } from '#lib/errors.ts';

const GitHubIdentityTokenSchema = z.object({ value: z.string().min(1) });

type GitHubIdentityTokenInput = ReturnType<typeof readGitHubOidcRequest> & { audience: string };

export function readGitHubOidcRequest() {
  const env = createEnvContext({
    vars: {
      GITHUB_ACTIONS: { schema: z.string(), default: '' },
      ACTIONS_ID_TOKEN_REQUEST_URL: { schema: z.string(), default: '' },
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: { schema: z.string(), default: '' },
    },
  });
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    !env.ACTIONS_ID_TOKEN_REQUEST_URL ||
    !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  ) {
    throw new UsageError(
      `--${GITHUB_TRUSTED_OIDC_FLAG} requires GitHub Actions with id-token: write.`,
    );
  }
  return {
    requestUrl: env.ACTIONS_ID_TOKEN_REQUEST_URL,
    requestToken: env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
  };
}

export async function requestGitHubIdentityToken({
  requestUrl,
  requestToken,
  audience,
}: GitHubIdentityTokenInput): Promise<string> {
  maskGitHubSecret(requestToken);
  let response: Response;
  try {
    const url = new URL(requestUrl);
    url.searchParams.set('audience', audience);
    response = await fetch(url, {
      headers: { authorization: `Bearer ${requestToken}` },
      redirect: 'error',
    });
  } catch {
    throw new DeploymentError(
      'Could not request GitHub identity: GitHub could not be reached. Check network connectivity, then retry.',
    );
  }
  if (!response.ok) {
    throw new DeploymentError(
      `GitHub refused the identity token request (HTTP ${response.status}). Check id-token: write permission on the deployment job.`,
    );
  }
  const payload: unknown = await response.json().catch(function invalidResponse() {
    return null;
  });
  const result = GitHubIdentityTokenSchema.safeParse(payload);
  if (result.success) {
    return result.data.value;
  }
  throw new DeploymentError(
    'GitHub returned an invalid identity token response. Retry the workflow.',
  );
}

export function maskGitHubSecret(secret: string): void {
  const escaped = secret.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  process.stderr.write(`::add-mask::${escaped}\n`);
}
