import { Toaster } from '@repo/ui/components/sonner';
import appCss from '@repo/ui/globals.css?url';
import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { SITE_TITLE, SITE_URL } from '#lib/site.ts';
import { themeScript } from '#lib/theme-script.ts';

const OG_IMAGE = `${SITE_URL}/og.png`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#0a1410' },
      { property: 'og:site_name', content: 'nibrun' },
      { property: 'og:locale', content: 'en_US' },
      { property: 'og:image', content: OG_IMAGE },
      { property: 'og:image:type', content: 'image/png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: SITE_TITLE },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:image', content: OG_IMAGE },
      { name: 'twitter:image:alt', content: SITE_TITLE },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
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
        <Toaster />
        <Scripts />
      </body>
    </html>
  );
}
