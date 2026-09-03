import { PRODUCT_NAME, WWW_SITE } from '@repo/global-constants';
import { Toaster } from '@repo/ui/components/sonner';
import appCss from '@repo/ui/globals.css?url';
import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { themeScript } from '#lib/theme-script.ts';

const OG_IMAGE = `${WWW_SITE.url}/og.png`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#0a1410' },
      { property: 'og:site_name', content: PRODUCT_NAME },
      { property: 'og:locale', content: 'en_US' },
      { property: 'og:image', content: OG_IMAGE },
      { property: 'og:image:type', content: 'image/png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: WWW_SITE.title },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:image', content: OG_IMAGE },
      { name: 'twitter:image:alt', content: WWW_SITE.title },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'alternate',
        type: 'text/markdown',
        href: `${WWW_SITE.url}/llms.txt`,
        title: `${PRODUCT_NAME} for agents`,
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
