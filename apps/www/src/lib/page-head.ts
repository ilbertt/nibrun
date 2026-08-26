import { SITE_URL } from '#lib/site.ts';

/**
 * The tags that differ per page, kept in one place because one of them cannot be repeated:
 * the router dedupes `meta` by name, so a route overriding the root's is free, but it renders
 * every `link` a match contributes — two routes each declaring a canonical would emit both.
 */
export function pageHead({
  path,
  title,
  description,
  publishedAt,
}: {
  path: string;
  title: string;
  description: string;
  publishedAt?: string;
}) {
  const url = `${SITE_URL}${path}`;

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
    ],
    links: [{ rel: 'canonical', href: url }],
  };
}
