import { WWW_DEPLOY_PATH, WWW_SITE } from '@repo/global-constants';
import { Button } from '@repo/ui/components/button';
import { GithubMark } from '@repo/ui/custom/github-mark';
import { useClipboardCopy } from '@repo/ui/hooks/use-clipboard-copy';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { ArrowLeftIcon, CheckIcon, SparklesIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CodeCopyButton } from '#components/code-copy-button.tsx';
import { PageBackdrop } from '#components/page-backdrop.tsx';
import { SiteHeader } from '#components/site-header.tsx';
import { APPS, type CatalogApp, findApp, renderApp, repoName } from '#lib/apps.ts';
import { pageHead } from '#lib/page-head.ts';
import { pageTitle } from '#lib/page-title.ts';
import '#styles/prose.css';

const RELATED_SHOWN = 4;

export const Route = createFileRoute('/apps/$slug')({
  // Returns nothing: the page is already in the bundle, and handing it back would serialize the
  // whole body into the page a second time, beside the HTML it was rendered into.
  loader: ({ params }) => {
    if (findApp(params.slug) === undefined) {
      throw notFound();
    }
  },
  head: ({ params }) => {
    const app = findApp(params.slug);
    if (app === undefined) {
      return {};
    }
    return pageHead({
      path: `/apps/${app.slug}`,
      // What somebody searching actually types, which is the app's name and the wish to run it
      // somewhere — not the catalog's name for itself.
      title: pageTitle(`Deploy ${app.title}`),
      description: `${app.subtitle} Deployed in one click on nibrun — ${app.version}, pinned by digest, on a microVM of its own.`,
      markdown: { path: markdownPath(app), title: `${app.title} in Markdown` },
    });
  },
  component: RouteComponent,
});

function markdownPath(app: CatalogApp): string {
  return `/apps/${app.slug}.md`;
}

function deployPath(app: CatalogApp): string {
  return `${WWW_DEPLOY_PATH}/${app.slug}`;
}

/**
 * The prompt rather than the page: what an agent needs is this app's source and the address it
 * deploys from, and what the reader wants is to hand that over without reading it themselves.
 */
function agentPrompt(app: CatalogApp): string {
  return `Deploy ${app.title} on nibrun for me. Read ${WWW_SITE.url}${markdownPath(app)} first, then open ${WWW_SITE.url}${deployPath(app)} and fill in whatever it asks for.`;
}

function AskYourAgent({ app }: { app: CatalogApp }) {
  const { copied, copy } = useClipboardCopy(agentPrompt(app));

  return (
    <Button variant="outline" size="lg" onClick={copy}>
      {copied ? <CheckIcon data-icon="inline-start" /> : <SparklesIcon data-icon="inline-start" />}
      {copied ? 'Prompt copied' : 'Ask your agent'}
    </Button>
  );
}

type CodeBlock = { key: string; slot: Element; code: string };

/**
 * The body is one block of HTML, so the copy buttons cannot be written into it as components.
 * They are portalled into the slots the renderer left behind instead, which keeps the clipboard
 * behaviour in one place rather than reimplemented against the DOM.
 */
function AppBody({ app }: { app: CatalogApp }) {
  // Stable across renders, and not only to save the parse: React compares this prop by object
  // identity, so a fresh one re-runs `innerHTML =` and replaces the very slots the portals below
  // are pointed at — leaving the buttons mounted in nodes no longer on the page.
  const content = useMemo(() => ({ __html: renderApp(app) }), [app]);
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

function Sidebar({ app }: { app: CatalogApp }) {
  return (
    <dl className="flex flex-col gap-5 text-sm">
      <div className="flex flex-col gap-1">
        <dt className="text-muted-foreground text-xs uppercase tracking-wide">Repository</dt>
        <dd>
          <a
            className="inline-flex items-center gap-1.5 underline"
            href={app.repositoryUrl}
            target="_blank"
            rel="noreferrer"
          >
            <GithubMark className="size-4" />
            {repoName(app)}
          </a>
        </dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="text-muted-foreground text-xs uppercase tracking-wide">Version</dt>
        <dd className="font-mono">{app.version}</dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="text-muted-foreground text-xs uppercase tracking-wide">Category</dt>
        <dd>
          <Link to="/apps" search={{ category: app.category }} className="underline">
            {app.category}
          </Link>
        </dd>
      </div>
    </dl>
  );
}

function Related({ app }: { app: CatalogApp }) {
  const related = APPS.filter(
    (other) => other.slug !== app.slug && other.category === app.category,
  ).slice(0, RELATED_SHOWN);

  if (related.length === 0) {
    return null;
  }

  return (
    // Clear of the article rather than tight against it: the rule reads as the end of what was
    // being read, and it needs the room to say so.
    <section className="mt-16 border-border/60 border-t pt-10 sm:mt-20">
      <h2 className="pb-4 text-muted-foreground text-xs uppercase tracking-wide">
        <Link to="/apps" search={{ category: app.category }} className="hover:text-primary">
          More in {app.category}
        </Link>
      </h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {related.map((other) => (
          <li key={other.slug}>
            <Link
              to="/apps/$slug"
              params={{ slug: other.slug }}
              className="group flex flex-col gap-1"
            >
              <span className="font-medium group-hover:text-primary">{other.title}</span>
              <span className="text-muted-foreground text-sm">{other.subtitle}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RouteComponent() {
  const { slug } = Route.useParams();
  const app = findApp(slug);
  if (app === undefined) {
    return null;
  }

  return (
    <>
      <PageBackdrop />
      <main className="mx-auto flex w-full max-w-5xl flex-col px-6 pb-16 sm:pb-20">
        <SiteHeader />
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          render={<Link to="/apps" search={{ category: undefined }} />}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          All apps
        </Button>
        <header className="flex flex-col gap-4 py-8">
          <h1 className="text-balance font-semibold text-4xl tracking-tight">Deploy {app.title}</h1>
          <p className="max-w-2xl text-balance text-lg text-muted-foreground">{app.subtitle}</p>
          <div className="flex flex-wrap items-center gap-2">
            {/* The short link the README hands out, not the deploy it expands to: the worker
                knows what it stands for, and this is an address somebody reads and sends on.
                A new tab, because the instructions below are what the reader follows next. */}
            <Button
              size="lg"
              render={<a href={deployPath(app)} target="_blank" rel="noreferrer" />}
            >
              Deploy on nibrun
            </Button>
            <AskYourAgent app={app} />
          </div>
        </header>
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <article className="min-w-0">
            <AppBody app={app} />
          </article>
          <aside className="lg:pt-10">
            <Sidebar app={app} />
          </aside>
        </div>
        <Related app={app} />
      </main>
    </>
  );
}
