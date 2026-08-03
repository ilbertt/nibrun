import { type HttpClient, httpFetch } from '#lib/http.ts';

const IMDS_BASE_URL = 'http://169.254.169.254';
const TOKEN_PATH = '/latest/api/token';
const ROLE_PATH = '/latest/meta-data/iam/security-credentials/';
const TOKEN_TTL_HEADER = 'x-aws-ec2-metadata-token-ttl-seconds';
const TOKEN_HEADER = 'x-aws-ec2-metadata-token';
const TOKEN_TTL_SECONDS = 21_600;
const REQUEST_TIMEOUT_MS = 5_000;
// Refreshed well before expiry: the credential has to outlive the S3 transfer it is handed to,
// and a large artifact takes longer than the margin a just-in-time refresh would leave.
const REFRESH_MARGIN_MS = 300_000;

export type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiresAtMs?: number;
};

export class InstanceCredentialsError extends Error {
  constructor(detail: string) {
    super(`Could not read instance role credentials: ${detail}`);
    this.name = 'InstanceCredentialsError';
  }
}

export function credentialsFromEnvironment(
  env: Record<string, string | undefined>,
): AwsCredentials | undefined {
  const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) {
    return undefined;
  }
  const sessionToken = env.AWS_SESSION_TOKEN?.trim();
  return { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) };
}

export function needsRefresh({
  credentials,
  nowMs,
  marginMs = REFRESH_MARGIN_MS,
}: {
  credentials: AwsCredentials | undefined;
  nowMs: number;
  marginMs?: number;
}): boolean {
  if (!credentials) {
    return true;
  }
  if (credentials.expiresAtMs === undefined) {
    return false;
  }
  return credentials.expiresAtMs - marginMs <= nowMs;
}

export function parseCredentialsDocument(value: unknown): AwsCredentials {
  const document = value as Record<string, unknown> | null;
  const accessKeyId = document?.AccessKeyId;
  const secretAccessKey = document?.SecretAccessKey;
  const sessionToken = document?.Token;
  if (typeof accessKeyId !== 'string' || typeof secretAccessKey !== 'string') {
    throw new InstanceCredentialsError('response carried no key pair');
  }
  const expiration = document?.Expiration;
  const expiresAtMs = typeof expiration === 'string' ? Date.parse(expiration) : Number.NaN;
  return {
    accessKeyId,
    secretAccessKey,
    ...(typeof sessionToken === 'string' ? { sessionToken } : {}),
    ...(Number.isFinite(expiresAtMs) ? { expiresAtMs } : {}),
  };
}

/**
 * IMDSv2 by hand.
 *
 * Bun's S3 client resolves static credentials only, and this agent carries no third-party
 * dependencies, so the instance role is read here and handed over explicitly. IMDSv2 rather
 * than v1 because the session-token handshake is what makes a request forgeable only by
 * something already running on the host.
 */
export async function fetchInstanceCredentials(
  options: { http?: HttpClient; baseUrl?: string } = {},
): Promise<AwsCredentials> {
  const http: HttpClient = options.http ?? httpFetch;
  const baseUrl = options.baseUrl ?? IMDS_BASE_URL;
  const tokenResponse = await http({
    url: `${baseUrl}${TOKEN_PATH}`,
    method: 'PUT',
    headers: { [TOKEN_TTL_HEADER]: String(TOKEN_TTL_SECONDS) },
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  if (!tokenResponse.ok) {
    throw new InstanceCredentialsError(`token request answered ${tokenResponse.status}`);
  }
  const headers = { [TOKEN_HEADER]: await tokenResponse.text() };

  const roleResponse = await http({
    url: `${baseUrl}${ROLE_PATH}`,
    headers,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  if (!roleResponse.ok) {
    throw new InstanceCredentialsError(`role listing answered ${roleResponse.status}`);
  }
  const roleName = (await roleResponse.text()).trim().split('\n')[0]?.trim();
  if (!roleName) {
    throw new InstanceCredentialsError('no role is attached to this instance');
  }

  const credentialsResponse = await http({
    url: `${baseUrl}${ROLE_PATH}${roleName}`,
    headers,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  if (!credentialsResponse.ok) {
    throw new InstanceCredentialsError(`credential request answered ${credentialsResponse.status}`);
  }
  return parseCredentialsDocument(await credentialsResponse.json());
}

export class InstanceCredentialProvider {
  #cached: AwsCredentials | undefined;
  readonly #env: Record<string, string | undefined>;
  readonly #http: HttpClient;

  constructor({
    env = Bun.env,
    http = httpFetch,
  }: { env?: Record<string, string | undefined>; http?: HttpClient } = {}) {
    this.#env = env;
    this.#http = http;
  }

  async resolve(): Promise<AwsCredentials> {
    const fromEnvironment = credentialsFromEnvironment(this.#env);
    if (fromEnvironment) {
      return fromEnvironment;
    }
    if (needsRefresh({ credentials: this.#cached, nowMs: Date.now() })) {
      this.#cached = await fetchInstanceCredentials({ http: this.#http });
    }
    if (!this.#cached) {
      throw new InstanceCredentialsError('no credentials available');
    }
    return this.#cached;
  }
}
