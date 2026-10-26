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
