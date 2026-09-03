export const PRODUCT_NAME = 'nibrun';

export const BASE_DOMAIN = 'nibrun.com';

export type Site = {
  url: string;
  devUrl: string;
  title: string;
  description: string;
};

export const WWW_SITE: Site = {
  url: `https://${BASE_DOMAIN}`,
  devUrl: 'http://localhost:3002',
  title: `${PRODUCT_NAME} — one-click deployment for any single-binary app`,
  description:
    "Small apps don't need to scale. Drop a compiled binary and get a microVM of its own, a persistent filesystem, and an HTTPS URL. Export the binary and the whole disk whenever you want.",
};

export const DASHBOARD_SITE: Site = {
  url: `https://app.${BASE_DOMAIN}`,
  devUrl: 'http://localhost:3001',
  title: `Deploy on ${PRODUCT_NAME}`,
  description:
    'One click deployment of your app. Drop the compiled binary or point at its url, and it gets a microVM of its own, a filesystem that persists, and an HTTPS URL.',
};

export const HELLO_EMAIL = `hello@${BASE_DOMAIN}`;
