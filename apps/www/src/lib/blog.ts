import { marked } from 'marked';

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  date: string;
  /** The file as it sits in the repo, frontmatter and all — what `/blog/<slug>.md` serves. */
  markdown: string;
};

const MARKDOWN_EXTENSION = '.md';
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

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
  return marked.parse(post.markdown.replace(FRONTMATTER, ''), { async: false });
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

function slugOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1, -MARKDOWN_EXTENSION.length);
}

// Every failure here throws, which fails the build rather than publishing a post with no title.
function read({ slug, markdown }: { slug: string; markdown: string }): BlogPost {
  const block = FRONTMATTER.exec(markdown)?.[1];
  if (block === undefined) {
    throw new Error(`${slug}${MARKDOWN_EXTENSION} opens with no frontmatter block`);
  }

  const fields = new Map(block.split('\n').map((line) => field({ slug, line })));

  return {
    slug,
    title: required({ slug, fields, key: 'title' }),
    description: required({ slug, fields, key: 'description' }),
    date: required({ slug, fields, key: 'date' }),
    markdown,
  };
}

function field({ slug, line }: { slug: string; line: string }): [string, string] {
  const separator = line.indexOf(':');
  if (separator < 0) {
    throw new Error(`${slug}${MARKDOWN_EXTENSION} has a frontmatter line with no key: ${line}`);
  }
  return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
}

function required({
  slug,
  fields,
  key,
}: {
  slug: string;
  fields: Map<string, string>;
  key: string;
}): string {
  const value = fields.get(key);
  if (value === undefined || value === '') {
    throw new Error(`${slug}${MARKDOWN_EXTENSION} is missing a ${key}`);
  }
  return value;
}
