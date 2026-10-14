import { createPublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import { GITHUB_ACTIONS_OIDC_AUDIENCE } from '@repo/api-constants';

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
    try {
      const identity = await this.input.getIdentityToken(GITHUB_ACTIONS_OIDC_AUDIENCE);
      this.input.maskSecret(identity);
      const api = createPublicApiClient({
        baseUrl: this.input.apiUrl,
        headers: { authorization: `Bearer ${identity}` },
      });
      const credential = unwrap(
        await api.api.apps({ appId: this.input.appId })['deployment-tokens'].post(),
      );
      this.input.maskSecret(credential.token);
      const expiresAt = Date.parse(credential.expiresAt);
      if (!credential.token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error('Invalid deployment credential.');
      }
      this.token = { value: credential.token, expiresAt };
      return this.token.value;
    } catch {
      throw new Error(
        "Could not obtain deployment access. Check the app's trusted GitHub workflow and id-token: write permission.",
      );
    }
  }
}
