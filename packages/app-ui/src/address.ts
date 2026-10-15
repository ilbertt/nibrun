/**
 * Prefer an active custom domain: pending domains may not resolve yet, while the platform
 * hostname remains available.
 */
export function servingHostname(
  hostnames: ReadonlyArray<{ hostname: string; kind: string; state: string }>,
): string {
  const serving =
    hostnames.find((entry) => entry.kind === 'custom' && entry.state === 'active') ??
    hostnames.find((entry) => entry.kind === 'platform') ??
    hostnames[0];
  if (!serving) {
    throw new Error('The app was created without a hostname.');
  }
  return serving.hostname;
}

export function hostnameUrl(hostname: string): string {
  return `https://${hostname}`;
}

export function appUrl(hostnames: Parameters<typeof servingHostname>[0]): string {
  return hostnameUrl(servingHostname(hostnames));
}
