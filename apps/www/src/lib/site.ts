export const SITE_URL = 'https://nibrun.com';

export const SITE_TITLE = 'nibrun — drop your binary, get a server';

/** Every page but the landing one, which is named after the site rather than suffixed with it. */
export function pageTitle(name: string): string {
  return `${name} | nibrun`;
}

export const SITE_DESCRIPTION =
  "Small apps don't need to scale. Drop a compiled binary and get a microVM of its own, a filesystem that persists, and an HTTPS URL. Export the binary and the whole disk whenever you want.";
