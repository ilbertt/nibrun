export const CLOUDFLARE_ACCESS_DOMAIN_HINT =
  'Associate a custom domain with this app to enable Cloudflare Access.';
export const CLOUDFLARE_ACCESS_HEADER = 'Cf-Access-Jwt-Assertion';

export function isCloudflareAccessHeader(header: string): boolean {
  return header.toLowerCase() === CLOUDFLARE_ACCESS_HEADER.toLowerCase();
}
