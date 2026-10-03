export const PRODUCT_NAME = 'nibrun';

export const BASE_DOMAIN = 'nibrun.com';

export type Site = {
  url: string;
  devUrl: string;
  title: string;
  description: string;
  ogImage: {
    url: string;
    type: string;
    width: number;
    height: number;
  };
};

function site(fields: Omit<Site, 'ogImage'>): Site {
  return {
    ...fields,
    ogImage: { url: `${fields.url}/og.png`, type: 'image/png', width: 1200, height: 630 },
  };
}

export const WWW_SITE = site({
  url: `https://${BASE_DOMAIN}`,
  devUrl: 'http://localhost:3002',
  title: `${PRODUCT_NAME} — one-click deployment for any single-binary app`,
  description:
    "Small apps don't need to scale. Drop a compiled binary and get a microVM of its own, a persistent filesystem, and an HTTPS URL. Export the binary and the whole disk whenever you want.",
});

export const DASHBOARD_SITE = site({
  url: `https://app.${BASE_DOMAIN}`,
  devUrl: 'http://localhost:3001',
  title: `Deploy on ${PRODUCT_NAME}`,
  description:
    'One click deployment of your app. Drop the compiled binary or point at its url, and it gets a microVM of its own, a filesystem that persists, and an HTTPS URL.',
});

export const HELLO_EMAIL = `hello@${BASE_DOMAIN}`;
