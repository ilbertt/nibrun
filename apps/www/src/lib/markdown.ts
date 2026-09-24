import { Marked, Renderer, type Token, type Tokens } from 'marked';

export const MARKDOWN_EXTENSION = '.md';

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

/** The file as it is written, minus the block this module read its fields out of. */
export function withoutFrontmatter(markdown: string): string {
  return markdown.replace(FRONTMATTER, '');
}

/**
 * The frontmatter as a map, or a thrown error naming the file. Every failure here fails the
 * build, which is the point: a page with no title is not something to find out about in
 * production.
 */
export function frontmatterOf({ slug, markdown }: { slug: string; markdown: string }): FieldReader {
  const block = FRONTMATTER.exec(markdown)?.[1];
  if (block === undefined) {
    throw new Error(`${slug}${MARKDOWN_EXTENSION} opens with no frontmatter block`);
  }
  const fields = new Map(block.split('\n').map((line) => field({ slug, line })));
  return {
    required: (key) => required({ slug, fields, key }),
    optional: (key) => fields.get(key),
  };
}

export type FieldReader = {
  required: (key: string) => string;
  optional: (key: string) => string | undefined;
};

export function slugOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1, -MARKDOWN_EXTENSION.length);
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

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

export function renderMarkdown(markdown: string): string {
  return ARTICLE.parse(withoutFrontmatter(markdown), { async: false });
}
