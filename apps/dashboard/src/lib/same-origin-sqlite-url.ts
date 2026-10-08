// The development dashboard proxies the API on a different port.
export function sameOriginSqliteUrl(url: string): string {
  return new URL(new URL(url).pathname, window.location.origin).href;
}
