import { createFileRoute, Link } from '@tanstack/react-router';
import { PageBackdrop } from '#components/page-backdrop.tsx';
import { SiteHeader } from '#components/site-header.tsx';
import { formatPostDate, POSTS } from '#lib/blog.ts';
import { pageHead } from '#lib/page-head.ts';
import { pageTitle } from '#lib/site.ts';

const TITLE = pageTitle('Blog');
const DESCRIPTION = "Notes on small apps, single binaries, and the infrastructure they don't need.";

export const Route = createFileRoute('/blog/')({
  head: () => pageHead({ path: '/blog', title: TITLE, description: DESCRIPTION }),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <>
      <PageBackdrop />
      <main className="mx-auto flex w-full max-w-3xl flex-col px-6">
        <SiteHeader />
        <div className="flex flex-col gap-3 py-12 sm:py-16">
          <h1 className="font-semibold text-4xl tracking-tight">Blog</h1>
          <p className="text-balance text-lg text-muted-foreground">{DESCRIPTION}</p>
        </div>
        <ul className="flex flex-col border-border/60 border-t">
          {POSTS.map((post) => (
            <li key={post.slug}>
              <Link
                to="/blog/$slug"
                params={{ slug: post.slug }}
                className="group flex flex-col gap-2 border-border/60 border-b py-8 transition-colors hover:bg-muted/40"
              >
                <time dateTime={post.date} className="text-muted-foreground text-sm">
                  {formatPostDate(post.date)}
                </time>
                <h2 className="text-pretty font-medium text-xl tracking-tight group-hover:text-primary">
                  {post.title}
                </h2>
                <p className="text-pretty text-muted-foreground">{post.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
