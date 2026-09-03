import { SITE_URL } from '@repo/global-constants';
import { Button } from '@repo/ui/components/button';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { ArrowLeftIcon, FileTextIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CodeCopyButton } from '#components/code-copy-button.tsx';
import { DeployCta } from '#components/deploy-cta.tsx';
import { PageBackdrop } from '#components/page-backdrop.tsx';
import { SiteHeader } from '#components/site-header.tsx';
import { type BlogPost, findPost, formatPostDate, renderPost } from '#lib/blog.ts';
import { pageHead } from '#lib/page-head.ts';
import { pageTitle } from '#lib/site.ts';
import '#styles/prose.css';

export const Route = createFileRoute('/blog/$slug')({
  // Returns nothing: the post is already in the bundle, and handing it back would serialize the
  // whole article into the page a second time, beside the HTML it was rendered into.
  loader: ({ params }) => {
    if (findPost(params.slug) === undefined) {
      throw notFound();
    }
  },
  head: ({ params }) => {
    const post = findPost(params.slug);
    if (post === undefined) {
      return {};
    }
    const head = pageHead({
      path: `/blog/${post.slug}`,
      title: pageTitle(post.title),
      description: post.description,
      publishedAt: post.date,
      image: post.image,
    });

    return {
      ...head,
      links: [
        ...head.links,
        {
          rel: 'alternate',
          type: 'text/markdown',
          href: markdownPath(post),
          title: 'This post in Markdown',
        },
      ],
    };
  },
  component: RouteComponent,
});

type CodeBlock = { key: string; slot: Element; code: string };

/**
 * The article is one block of HTML, so the copy buttons cannot be written into it as components.
 * They are portalled into the slots the renderer left behind instead, which keeps the clipboard
 * behaviour in one place rather than reimplemented against the DOM. The slots are empty in the
 * prerendered page and fill in on hydration; the space they take is already reserved.
 */
function ArticleBody({ post }: { post: BlogPost }) {
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

function markdownPath(post: BlogPost): string {
  return `${SITE_URL}/blog/${post.slug}.md`;
}

function RouteComponent() {
  const { slug } = Route.useParams();
  const post = findPost(slug);
  if (post === undefined) {
    return null;
  }

  return (
    <>
      <PageBackdrop />
      <main className="mx-auto flex w-full max-w-3xl flex-col px-6">
        <SiteHeader />
        <article className="flex flex-col pb-12 sm:pb-16">
          <Button variant="ghost" size="sm" className="self-start" render={<Link to="/blog" />}>
            <ArrowLeftIcon data-icon="inline-start" />
            All posts
          </Button>
          <header className="flex flex-col gap-4 py-8">
            <time dateTime={post.date} className="text-muted-foreground text-sm">
              {formatPostDate(post.date)}
            </time>
            <h1 className="text-balance font-semibold text-4xl tracking-tight">{post.title}</h1>
            <p className="text-balance text-lg text-muted-foreground">{post.description}</p>
            {/* Not a router link: the target is a file the worker hands back, not a route. */}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              render={<a href={`/blog/${post.slug}.md`} />}
            >
              <FileTextIcon data-icon="inline-start" />
              View markdown
            </Button>
          </header>
          <ArticleBody post={post} />
        </article>
        <DeployCta />
      </main>
    </>
  );
}
