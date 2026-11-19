const TEAM =
  /^(?:https:\/\/)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.cloudflareaccess\.com)?\/?$/i;

export const CLOUDFLARE_ACCESS_DOMAIN_HINT =
  'Associate a custom domain with this app to enable Cloudflare Access.';
export const CLOUDFLARE_ACCESS_HEADER = 'Cf-Access-Jwt-Assertion';
export const CLOUDFLARE_ACCESS_CERTS_PATH = '/cdn-cgi/access/certs';

export function cloudflareTeamIssuer(team: string): string | undefined {
  const label = TEAM.exec(team.trim())?.[1];
  return label && `https://${label.toLowerCase()}.cloudflareaccess.com`;
}

export function isCloudflareAccessPreset(jwt: {
  issuer: string;
  publicKeys: { url: string };
  token: { header: string; format: string };
  audiences: readonly string[];
}): boolean {
  return (
    cloudflareTeamIssuer(jwt.issuer) === jwt.issuer &&
    jwt.publicKeys.url === jwt.issuer + CLOUDFLARE_ACCESS_CERTS_PATH &&
    jwt.token.header.toLowerCase() === CLOUDFLARE_ACCESS_HEADER.toLowerCase() &&
    jwt.token.format === 'raw' &&
    jwt.audiences.length === 1
  );
}
