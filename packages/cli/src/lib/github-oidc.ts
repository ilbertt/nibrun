import { createEnvContext } from '@parshjs/env';
import { z } from 'zod';
import { GITHUB_TRUSTED_OIDC_FLAG } from '#config.ts';
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
  try {
    const url = new URL(requestUrl);
    url.searchParams.set('audience', audience);
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${requestToken}` },
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error('GitHub did not issue an identity token.');
    }
    const result = GitHubIdentityTokenSchema.safeParse(await response.json());
    if (!result.success) {
      throw new Error('GitHub did not return an identity token.');
    }
    return result.data.value;
  } catch {
    throw new Error('Could not request GitHub identity. Check id-token: write permission.');
  }
}

export function maskGitHubSecret(secret: string): void {
  const escaped = secret.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  process.stderr.write(`::add-mask::${escaped}\n`);
}
