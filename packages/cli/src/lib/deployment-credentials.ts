import { createPublicApiClient } from '@repo/api-client/public';
import { GITHUB_ACTIONS_OIDC_AUDIENCE } from '@repo/api-constants';
import { DeploymentError, deploymentApiRequest } from '#lib/deployment-error.ts';

const EXPIRY_MARGIN_MS = 30_000;
export type DeploymentCredentialsInput = {
  apiUrl: string;
  appId: string;
  getIdentityToken: (audience: string) => Promise<string>;
  maskSecret: (secret: string) => void;
};
export interface DeploymentCredentialsContract {
  accessToken(): Promise<string>;
}

export class DeploymentCredentials implements DeploymentCredentialsContract {
  private readonly input: DeploymentCredentialsInput;
  private token: { value: string; expiresAt: number } | undefined;

  constructor(input: DeploymentCredentialsInput) {
    const api = new URL(input.apiUrl);
    if (
      api.protocol !== 'https:' ||
      api.username ||
      api.password ||
      api.pathname !== '/' ||
      api.search ||
      api.hash
    ) {
      throw new Error('api-url must be an HTTPS origin without credentials or a path.');
    }
    this.input = { ...input, apiUrl: api.origin };
  }

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + EXPIRY_MARGIN_MS) {
      return this.token.value;
    }
    const identity = await this.identityToken();
    this.input.maskSecret(identity);
    const api = createPublicApiClient({
      baseUrl: this.input.apiUrl,
      headers: { authorization: `Bearer ${identity}` },
    });
    const credential = await deploymentApiRequest({
      response: api.api.apps({ appId: this.input.appId })['deployment-tokens'].post(),
      operation: 'obtain deployment access',
      rejectionHint:
        'Check the app ID and its trusted GitHub repository, workflow filename, and environment.',
    });
    this.input.maskSecret(credential.token);
    const expiresAt = Date.parse(credential.expiresAt);
    if (!credential.token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new DeploymentError(
        'Could not obtain deployment access: nibrun returned an invalid or expired token.',
      );
    }
    this.token = { value: credential.token, expiresAt };
    return this.token.value;
  }

  private async identityToken(): Promise<string> {
    try {
      return await this.input.getIdentityToken(GITHUB_ACTIONS_OIDC_AUDIENCE);
    } catch (error) {
      if (error instanceof DeploymentError) {
        throw error;
      }
      throw new DeploymentError(
        'Could not request GitHub identity. Check id-token: write permission.',
      );
    }
  }
}
