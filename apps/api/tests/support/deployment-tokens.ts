import {
  DEPLOYMENT_TOKEN_PERMISSION,
  shortLivedDeploymentTokenConfiguration,
} from '#lib/auth/deployment-api-keys.ts';
import { GRANT_APP_ID, GRANT_ID, GRANT_OWNER_ID } from '#tests/support/github-deployment-grants.ts';

const TOKEN_LIFETIME_SECONDS = 60;
export async function deploymentToken({ grantId = GRANT_ID }: { grantId?: string }) {
  const { auth } = await import('#services/plugins.ts');
  const credential = await auth.api.createApiKey({
    body: {
      configId: shortLivedDeploymentTokenConfiguration.configId,
      userId: GRANT_OWNER_ID,
      expiresIn: TOKEN_LIFETIME_SECONDS,
      permissions: { [GRANT_APP_ID]: [DEPLOYMENT_TOKEN_PERMISSION] },
      metadata: { grantId },
    },
  });
  return credential.key;
}
