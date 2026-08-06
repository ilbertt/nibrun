interface CustomProcessEnv {
  // Entries here must match the .env.example file
  readonly PORT?: string;
  readonly BASE_URL?: string;
  readonly DATABASE_URL: string;
  readonly BETTER_AUTH_SECRET: string;
  readonly GITHUB_CLIENT_ID: string;
  readonly GITHUB_CLIENT_SECRET: string;
  readonly S3_ENDPOINT: string;
  readonly VICTORIALOGS_ENDPOINT: string;
  readonly ARTIFACTS_BUCKET: string;
  readonly EXPORTS_BUCKET: string;
  readonly EXPORT_RETENTION_DAYS?: string;
  readonly S3_ACCESS_KEY_ID: string;
  readonly S3_SECRET_ACCESS_KEY: string;
  readonly S3_REGION: string;
  readonly APP_HOST_DOMAIN: string;
}

const DEFAULT_PORT = '3000';
const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_PORT}`;

// Matches the exports bucket's own lifecycle rule, which is what actually removes the object;
// this end only decides how long it is willing to promise. Deployed from the same terraform
// variable, so the two move together rather than this one drifting past the rule.
const DEFAULT_EXPORT_RETENTION_DAYS = '1';

function required(name: keyof CustomProcessEnv): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional({
  name,
  defaultValue,
}: {
  name: keyof CustomProcessEnv;
  defaultValue: string;
}): string {
  return process.env[name] || defaultValue;
}

type Env = {
  PORT: number;
  BASE_URL: URL;
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  S3_ENDPOINT: URL;
  VICTORIALOGS_ENDPOINT: URL;
  ARTIFACTS_BUCKET: string;
  EXPORTS_BUCKET: string;
  EXPORT_RETENTION_DAYS: number;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_REGION: string;
  APP_HOST_DOMAIN: string;
};

function loadEnv(): Env {
  return {
    PORT: Number(optional({ name: 'PORT', defaultValue: DEFAULT_PORT })),
    BASE_URL: new URL(optional({ name: 'BASE_URL', defaultValue: DEFAULT_BASE_URL })),
    DATABASE_URL: required('DATABASE_URL'),
    BETTER_AUTH_SECRET: required('BETTER_AUTH_SECRET'),
    GITHUB_CLIENT_ID: required('GITHUB_CLIENT_ID'),
    GITHUB_CLIENT_SECRET: required('GITHUB_CLIENT_SECRET'),
    S3_ENDPOINT: new URL(required('S3_ENDPOINT')),
    VICTORIALOGS_ENDPOINT: new URL(required('VICTORIALOGS_ENDPOINT')),
    ARTIFACTS_BUCKET: required('ARTIFACTS_BUCKET'),
    EXPORTS_BUCKET: required('EXPORTS_BUCKET'),
    EXPORT_RETENTION_DAYS: Number(
      optional({ name: 'EXPORT_RETENTION_DAYS', defaultValue: DEFAULT_EXPORT_RETENTION_DAYS }),
    ),
    S3_ACCESS_KEY_ID: required('S3_ACCESS_KEY_ID'),
    S3_SECRET_ACCESS_KEY: required('S3_SECRET_ACCESS_KEY'),
    S3_REGION: required('S3_REGION'),
    APP_HOST_DOMAIN: required('APP_HOST_DOMAIN'),
  };
}

export const env = loadEnv();
