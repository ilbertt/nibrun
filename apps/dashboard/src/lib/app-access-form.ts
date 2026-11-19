import type { App } from '@repo/api-client/models';
import { DEFAULT_APP_ACCESS } from '@repo/api-constants';
import {
  CLOUDFLARE_ACCESS_CERTS_PATH,
  CLOUDFLARE_ACCESS_HEADER,
  cloudflareTeamIssuer,
  isCloudflareAccessPreset,
} from '@repo/app-ui';

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

const MODE_LABELS = {
  public: 'Public',
  cloudflare: 'Cloudflare Access',
  jwt: 'Custom JWT',
} as const;
export function accessModeLabel(mode: AccessMode): string {
  return MODE_LABELS[mode];
}

export function accessFields(access: AppAccess): AccessFields {
  const jwt = access.kind === 'jwt' ? access : undefined;
  const isCloudflare = jwt !== undefined && isCloudflareAccessPreset(jwt);
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
    const issuer = cloudflareTeamIssuer(fields.team);
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
        publicKeys: { url: issuer + CLOUDFLARE_ACCESS_CERTS_PATH },
        token: { header: CLOUDFLARE_ACCESS_HEADER, format: 'raw' },
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
