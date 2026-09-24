import { frontmatterOf, renderMarkdown, slugOf } from '#lib/markdown.ts';

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  date: string;
  /** The file as it sits in the repo, frontmatter and all — what `/blog/<slug>.md` serves. */
  markdown: string;
  /** The first image in the post, which is also the card it gets shared as. */
  image: string | undefined;
};

export const BLOG = {
  heading: 'Blog',
  description: "Notes on small apps, single binaries, and the infrastructure they don't need.",
};

const FIRST_IMAGE = /^!\[[^\]]*]\(([^\s)]+)/m;

const SOURCES = import.meta.glob('../content/blog/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Sorted here rather than at each call site, so a post's position is a property of the set and
// not of whoever renders it.
export const POSTS: readonly BlogPost[] = Object.entries(SOURCES)
  .map(([path, markdown]) => read({ slug: slugOf(path), markdown }))
  .sort(byNewestFirst);

export function findPost(slug: string): BlogPost | undefined {
  return POSTS.find((post) => post.slug === slug);
}

export function renderPost(post: BlogPost): string {
  return renderMarkdown(post.markdown);
}

export function postMarkdownPath(post: BlogPost): string {
  return `/blog/${post.slug}.md`;
}

// UTC on both sides: the date is a plain `YYYY-MM-DD`, which parses as UTC midnight, and
// formatting it in the reader's zone would show the day before it to anyone west of Greenwich.
const PUBLISHED = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' });

export function formatPostDate(date: string): string {
  return PUBLISHED.format(new Date(date));
}

// biome-ignore lint/complexity/useMaxParams: a comparator compares two posts
function byNewestFirst(first: BlogPost, second: BlogPost): number {
  return second.date.localeCompare(first.date);
}

// Every failure here throws, which fails the build rather than publishing a post with no title.
function read({ slug, markdown }: { slug: string; markdown: string }): BlogPost {
  const fields = frontmatterOf({ slug, markdown });

  return {
    slug,
    title: fields.required('title'),
    description: fields.required('description'),
    date: fields.required('date'),
    markdown,
    image: FIRST_IMAGE.exec(markdown)?.[1],
  };
}
