import appCss from '@repo/ui/globals.css?url';
import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { SITE_URL } from '#lib/site-url.ts';
import { themeScript } from '#lib/theme-script.ts';

const TITLE = 'nibrun — drop your binary, get a server';
const DESCRIPTION =
  'Drop a compiled binary and get a server: a microVM of its own, a persistent filesystem, and an HTTPS URL. No Dockerfile, no YAML, no cluster.';
const OG_IMAGE = `${SITE_URL}/og.png`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: TITLE },
      { name: 'description', content: DESCRIPTION },
      { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#0a1410' },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: `${SITE_URL}/` },
      { property: 'og:site_name', content: 'nibrun' },
      { property: 'og:locale', content: 'en_US' },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:image', content: OG_IMAGE },
      { property: 'og:image:type', content: 'image/png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: TITLE },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: TITLE },
      { name: 'twitter:description', content: DESCRIPTION },
      { name: 'twitter:image', content: OG_IMAGE },
      { name: 'twitter:image:alt', content: TITLE },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'canonical', href: `${SITE_URL}/` },
      {
        rel: 'alternate',
        type: 'text/markdown',
        href: `${SITE_URL}/llms.txt`,
        title: 'nibrun for agents',
      },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
