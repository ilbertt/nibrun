import type { AppAccessPolicy } from '@repo/protocol';

export const CLOUDFLARE_ACCESS = {
  kind: 'jwt',
  issuer: 'https://team.cloudflareaccess.com',
  audiences: ['reports'],
  token: { header: 'Cf-Access-Jwt-Assertion', format: 'raw' },
  publicKeys: { url: 'https://team.cloudflareaccess.com/cdn-cgi/access/certs' },
} satisfies AppAccessPolicy;
