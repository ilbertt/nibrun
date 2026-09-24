import { Button } from '@repo/ui/components/button';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { ArrowLeftIcon, FileTextIcon } from 'lucide-react';
import { ArticleBody } from '#components/article-body.tsx';
import { DeployCta } from '#components/deploy-cta.tsx';
import { PageBackdrop } from '#components/page-backdrop.tsx';
import { SiteHeader } from '#components/site-header.tsx';
import { findPost, formatPostDate, postMarkdownPath } from '#lib/blog.ts';
import { pageHead } from '#lib/page-head.ts';
import { pageTitle } from '#lib/page-title.ts';
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
    return pageHead({
      path: `/blog/${post.slug}`,
      title: pageTitle(post.title),
      description: post.description,
      publishedAt: post.date,
      image: post.image,
      markdown: { path: postMarkdownPath(post), title: 'This post in Markdown' },
    });
  },
  component: RouteComponent,
});

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
              render={<a href={postMarkdownPath(post)} />}
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
