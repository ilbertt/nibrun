export const SITE_URL = 'https://nibrun.com';

export const SITE_TITLE = 'nibrun — one-click deployment for any single-binary app';

/** Every page but the landing one, which is named after the site rather than suffixed with it. */
export function pageTitle(name: string): string {
  return `${name} | nibrun`;
}

export const SITE_DESCRIPTION =
  'Upload a compiled binary and it gets a Firecracker microVM of its own, 8 GiB of persistent disk, and an HTTPS URL. No Dockerfile, no YAML, no database to provision, and no machine of yours to keep patched.';

export const REPO_URL = 'https://github.com/ilbertt/nibrun';
