import { findPost } from '#lib/blog.ts';

const MARKDOWN_PATH = /^\/blog\/([a-z0-9-]+)\.md$/;

/**
 * The one URL on this site the worker answers itself. Every page is prerendered to a static file
 * and served from the edge, but a `.md` prerendered alongside them would be handed back with
 * whatever content type the extension is guessed to mean — and being read as markdown rather
 * than downloaded is the entire point of the URL.
 */
export function markdownResponse(request: Request): Response | undefined {
  const slug = MARKDOWN_PATH.exec(new URL(request.url).pathname)?.[1];
  const post = slug === undefined ? undefined : findPost(slug);

  return post === undefined
    ? undefined
    : new Response(post.markdown, { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
}
