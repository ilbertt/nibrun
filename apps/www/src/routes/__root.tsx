import { PRODUCT_NAME, WWW_SITE } from '@repo/global-constants';
import { Toaster } from '@repo/ui/components/sonner';
import appCss from '@repo/ui/globals.css?url';
import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { themeScript } from '#lib/theme-script.ts';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#0a1410' },
      { property: 'og:site_name', content: PRODUCT_NAME },
      { property: 'og:locale', content: 'en_US' },
      { property: 'og:image', content: WWW_SITE.ogImage.url },
      { property: 'og:image:type', content: WWW_SITE.ogImage.type },
      { property: 'og:image:width', content: `${WWW_SITE.ogImage.width}` },
      { property: 'og:image:height', content: `${WWW_SITE.ogImage.height}` },
      { property: 'og:image:alt', content: WWW_SITE.title },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:image', content: WWW_SITE.ogImage.url },
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
