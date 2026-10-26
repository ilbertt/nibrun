import monoFont from '@fontsource/space-mono/files/space-mono-latin-400-normal.woff2?url';
import sansFont from '@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url';
import { useAnalytics } from '@repo/analytics';
import { PRODUCT_NAME, WWW_SITE } from '@repo/global-constants';
import { Toaster } from '@repo/ui/components/sonner';
import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { SiteFooter } from '#components/site-footer.tsx';
import { themeScript } from '#lib/theme-script.ts';
import appCss from '#styles/site.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#0a1410' },
      { property: 'og:site_name', content: PRODUCT_NAME },
      { property: 'og:locale', content: 'en_US' },
      { property: 'og:image', content: WWW_SITE.ogImage.url },
      { property: 'og:image:width', content: `${WWW_SITE.ogImage.width}` },
      { property: 'og:image:height', content: `${WWW_SITE.ogImage.height}` },
      { property: 'og:image:alt', content: WWW_SITE.title },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:image', content: WWW_SITE.ogImage.url },
      { name: 'twitter:image:alt', content: WWW_SITE.title },
    ],
    links: [
      { rel: 'preload', href: sansFont, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
      { rel: 'preload', href: monoFont, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  useAnalytics();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <SiteFooter />
        <Toaster />
        <Scripts />
      </body>
    </html>
  );
}
