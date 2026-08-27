import { Marked, Renderer, type Token, type Tokens } from 'marked';

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

const MARKDOWN_EXTENSION = '.md';
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
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

// Borrowed rather than reimplemented, and always through `.call(this, …)`: these read
// `this.parser` to render their own inner tokens, and a standalone renderer has none.
const DEFAULT_RENDERER = new Renderer();

// The cast is what `type === 'image'` cannot do on its own: marked's token union ends in a
// generic member whose `type` is an open string, so nothing narrows away from it.
function loneImage(tokens: Token[]): Tokens.Image | undefined {
  const [only] = tokens;
  return tokens.length === 1 && only?.type === 'image' ? (only as Tokens.Image) : undefined;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// An empty slot rather than a rendered button: copying is a React component with the shared
// clipboard hook behind it, and this is the element it is portalled into once the page is
// interactive. The wrapper is what positions it, so it has to come from here and not from CSS.
const ARTICLE = new Marked({
  renderer: {
    code(token) {
      return `<div class="code-block">${DEFAULT_RENDERER.code.call(this, token)}<span data-copy-slot></span></div>`;
    },
    // A paragraph that is only an image is a figure, and markdown's image title is the one place
    // a caption can be written without dropping HTML into the post. Anything else falls through.
    paragraph(token) {
      const image = loneImage(token.tokens);
      if (image === undefined) {
        return false;
      }
      const caption =
        image.title === null ? '' : `<figcaption>${escapeHtml(image.title)}</figcaption>`;
      return `<figure>${DEFAULT_RENDERER.image.call(this, image)}${caption}</figure>\n`;
    },
  },
});

export function renderPost(post: BlogPost): string {
  return ARTICLE.parse(post.markdown.replace(FRONTMATTER, ''), { async: false });
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
    image: FIRST_IMAGE.exec(markdown)?.[1],
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
