export const CLOUDFLARE_ACCESS_HEADER = 'Cf-Access-Jwt-Assertion';

export function isCloudflareAccessHeader(header: string | null | undefined): boolean {
  return header?.toLowerCase() === CLOUDFLARE_ACCESS_HEADER.toLowerCase();
}
