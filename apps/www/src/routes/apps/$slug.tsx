import { Button } from '@repo/ui/components/button';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { ArrowLeftIcon } from 'lucide-react';
import { AppBody } from '#components/app-body.tsx';
import { AppSidebar } from '#components/app-sidebar.tsx';
import { AskYourAgent } from '#components/ask-your-agent.tsx';
import { PageBackdrop } from '#components/page-backdrop.tsx';
import { RelatedApps } from '#components/related-apps.tsx';
import { SiteHeader } from '#components/site-header.tsx';
import { appCardPath, appDeployPath, appMarkdownPath, findApp } from '#lib/apps.ts';
import { pageHead } from '#lib/page-head.ts';
import { pageTitle } from '#lib/page-title.ts';
import '#styles/prose.css';

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
      description: `${app.subtitle} Deployed in one click on nibrun.`,
      image: appCardPath(app),
      markdown: { path: appMarkdownPath(app), title: `${app.title} in Markdown` },
    });
  },
  component: RouteComponent,
});

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
              render={<a href={appDeployPath(app)} target="_blank" rel="noreferrer" />}
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
            <AppSidebar app={app} />
          </aside>
        </div>
        <RelatedApps app={app} />
      </main>
    </>
  );
}
