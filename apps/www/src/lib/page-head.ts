import { PRODUCT_NAME, WWW_SITE } from '@repo/global-constants';

/**
 * The tags that differ per page, kept in one place because some of them cannot be repeated:
 * the router dedupes `meta` by name, so a route overriding the root's is free, but it renders
 * every `link` a match contributes — a canonical or a Markdown alternate declared by both the
 * root and a route would emit both, and a post would advertise the site's Markdown beside its own.
 */
export function pageHead({
  path,
  title,
  description,
  publishedAt,
  image,
  markdown = { path: '/llms.txt', title: `${PRODUCT_NAME} for agents` },
}: {
  path: string;
  title: string;
  description: string;
  publishedAt?: string;
  /** Root-relative, and 1200x630 to match the dimensions the root route declares. */
  image?: string;
  /** The Markdown this page reads as, for agents; the site-wide entry point unless a page has one. */
  markdown?: { path: string; title: string };
}) {
  const url = `${WWW_SITE.url}${path}`;
  const card =
    image === undefined
      ? []
      : [
          { property: 'og:image', content: `${WWW_SITE.url}${image}` },
          { property: 'og:image:alt', content: title },
          { name: 'twitter:image', content: `${WWW_SITE.url}${image}` },
          { name: 'twitter:image:alt', content: title },
        ];

  return {
    meta: [
      { title },
      { name: 'description', content: description },
      { property: 'og:type', content: publishedAt === undefined ? 'website' : 'article' },
      { property: 'og:url', content: url },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
      ...(publishedAt === undefined
        ? []
        : [{ property: 'article:published_time', content: publishedAt }]),
      ...card,
    ],
    links: [
      { rel: 'canonical', href: url },
      {
        rel: 'alternate',
        type: 'text/markdown',
        href: `${WWW_SITE.url}${markdown.path}`,
        title: markdown.title,
      },
    ],
  };
}
