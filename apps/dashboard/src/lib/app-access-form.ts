import type { App } from '@repo/api-client/models';
import { DEFAULT_APP_ACCESS } from '@repo/api-constants';

export type AppAccess = App['config']['access'];
export type AccessMode = 'public' | 'cloudflare' | 'jwt';
export type AccessFields = {
  mode: AccessMode;
  team: string;
  cloudflareAudience: string;
  issuer: string;
  audiences: string;
  jwksUrl: string;
  header: string;
  format: Extract<AppAccess, { kind: 'jwt' }>['token']['format'];
};

const TEAM =
  /^(?:https:\/\/)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.cloudflareaccess\.com)?\/?$/i;
const MODE_LABELS = {
  public: 'Public',
  cloudflare: 'Cloudflare Access',
  jwt: 'Custom JWT',
} as const;
export function accessModeLabel(mode: AccessMode): string {
  return MODE_LABELS[mode];
}

const ASSERTION = 'Cf-Access-Jwt-Assertion';
const CERTS = '/cdn-cgi/access/certs';

function teamIssuer(team: string): string | undefined {
  const label = TEAM.exec(team.trim())?.[1];
  return label && `https://${label.toLowerCase()}.cloudflareaccess.com`;
}

export function accessFields(access: AppAccess): AccessFields {
  const jwt = access.kind === 'jwt' ? access : undefined;
  const isCloudflare =
    jwt !== undefined &&
    teamIssuer(jwt.issuer) === jwt.issuer &&
    jwt.publicKeys.url === jwt.issuer + CERTS &&
    jwt.token.header.toLowerCase() === ASSERTION.toLowerCase() &&
    jwt.token.format === 'raw' &&
    jwt.audiences.length === 1;
  return {
    mode: isCloudflare ? 'cloudflare' : access.kind,
    team: isCloudflare ? new URL(jwt.issuer).hostname : '',
    cloudflareAudience: isCloudflare ? (jwt.audiences[0] ?? '') : '',
    issuer: jwt?.issuer ?? '',
    audiences: jwt?.audiences.join('\n') ?? '',
    jwksUrl: jwt?.publicKeys.url ?? '',
    header: jwt?.token.header ?? 'Authorization',
    format: jwt?.token.format ?? 'bearer',
  };
}

type ParsedAccess = { policy: AppAccess; error?: never } | { error: string; policy?: never };

export function parseAccess(fields: AccessFields): ParsedAccess {
  if (fields.mode === 'public') {
    return { policy: DEFAULT_APP_ACCESS };
  }
  if (fields.mode === 'cloudflare') {
    const issuer = teamIssuer(fields.team);
    const audience = fields.cloudflareAudience.trim();
    if (!issuer) {
      return { error: 'Enter your Cloudflare team name or team domain.' };
    }
    if (!audience) {
      return { error: 'Enter the application audience (AUD) tag.' };
    }
    return {
      policy: {
        kind: 'jwt',
        issuer,
        audiences: [audience],
        publicKeys: { url: issuer + CERTS },
        token: { header: ASSERTION, format: 'raw' },
      },
    };
  }
  const issuer = fields.issuer.trim();
  const audiences = fields.audiences
    .split('\n')
    .map((audience) => audience.trim())
    .filter(Boolean);
  const url = URL.parse(fields.jwksUrl.trim());
  const header = fields.header.trim();
  if (!issuer || !audiences.length) {
    return { error: 'Enter an issuer and at least one audience.' };
  }
  if (new Set(audiences).size !== audiences.length) {
    return { error: 'Each audience must be unique.' };
  }
  if (url?.protocol !== 'https:' || url.username || url.password || url.hash) {
    return { error: 'Enter a public HTTPS JWKS URL without credentials or a fragment.' };
  }
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header)) {
    return { error: 'Enter a valid HTTP header name.' };
  }
  return {
    policy: {
      kind: 'jwt',
      issuer,
      audiences,
      publicKeys: { url: fields.jwksUrl.trim() },
      token: { header, format: fields.format },
    },
  };
}
