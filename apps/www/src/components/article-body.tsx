import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CodeCopyButton } from '#components/code-copy-button.tsx';
import { type BlogPost, renderPost } from '#lib/blog.ts';

type CodeBlock = { key: string; slot: Element; code: string };

/**
 * The article is one block of HTML, so the copy buttons cannot be written into it as components.
 * They are portalled into the slots the renderer left behind instead, which keeps the clipboard
 * behaviour in one place rather than reimplemented against the DOM. The slots are empty in the
 * prerendered page and fill in on hydration; the space they take is already reserved.
 */
export function ArticleBody({ post }: { post: BlogPost }) {
  // Stable across renders, and not only to save the parse: React compares this prop by object
  // identity, so a fresh one re-runs `innerHTML =` and replaces the very slots the portals below
  // are pointed at — leaving the buttons mounted in nodes no longer on the page.
  const content = useMemo(() => ({ __html: renderPost(post) }), [post]);
  const body = useRef<HTMLDivElement>(null);
  const [blocks, setBlocks] = useState<CodeBlock[]>([]);

  useEffect(() => {
    const collected: CodeBlock[] = [];
    for (const slot of body.current?.querySelectorAll('[data-copy-slot]') ?? []) {
      collected.push({
        key: `code-block-${collected.length}`,
        slot,
        code: slot.parentElement?.querySelector('code')?.textContent ?? '',
      });
    }
    setBlocks(collected);
  }, []);

  return (
    <>
      {/* The source is a file in this repo, written by us and compiled at build time. */}
      <div
        ref={body}
        className="prose border-border/60 border-t pt-10"
        dangerouslySetInnerHTML={content}
      />
      {blocks.map(({ key, slot, code }) => createPortal(<CodeCopyButton code={code} />, slot, key))}
    </>
  );
}
