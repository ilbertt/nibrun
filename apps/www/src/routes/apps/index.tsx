import { DeployCategory } from '@repo/deploy-link';
import { WWW_DEPLOY_PATH } from '@repo/global-constants';
import { Input } from '@repo/ui/components/input';
import { createFileRoute, Link } from '@tanstack/react-router';
import { SearchIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppCard } from '#components/app-card.tsx';
import { PageBackdrop } from '#components/page-backdrop.tsx';
import { SiteHeader } from '#components/site-header.tsx';
import { APPS, CATALOG } from '#lib/apps.ts';
import {
  ALL,
  asCategory,
  type CatalogSearch,
  type Chip,
  counted,
  matches,
} from '#lib/catalog-filter.ts';
import { pageHead } from '#lib/page-head.ts';
import { pageTitle } from '#lib/page-title.ts';
import '#styles/panel.css';

const RECOMMENDED_APPS = APPS.filter((app) => app.isRecommended);

export const Route = createFileRoute('/apps/')({
  validateSearch: (search: Record<string, unknown>): CatalogSearch => ({
    category: asCategory(search.category),
  }),
  head: () =>
    pageHead({
      path: '/apps',
      title: pageTitle(CATALOG.heading),
      description: CATALOG.description,
      image: CATALOG.cardPath,
      markdown: { path: CATALOG.markdownPath, title: 'This catalog in Markdown' },
    }),
  component: RouteComponent,
});

function RouteComponent() {
  const [query, setQuery] = useState('');
  const { category } = Route.useSearch();
  const selected: Chip = category ?? ALL;
  const showRecommended = query.trim() === '' && category === undefined;
  // Only the ones something is actually in, so the row never offers a filter that empties the
  // page. Annotated because a literal spreading the members beside `ALL` widens to `string`.
  const chips: readonly Chip[] = [
    ALL,
    ...Object.values(DeployCategory).filter((category) =>
      APPS.some((app) => app.category === category),
    ),
  ];
  const search = useRef<HTMLInputElement>(null);

  // `/` focuses the field, the way a search box on a page of results is reached everywhere else.
  // Ignored while something is already taking text, or it would swallow the character.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement);
      if (event.key !== '/' || event.metaKey || event.ctrlKey || typing) {
        return;
      }
      event.preventDefault();
      search.current?.focus();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const shown = useMemo(
    () =>
      APPS.filter(
        (app) => (category === undefined || app.category === category) && matches({ app, query }),
      ),
    [query, category],
  );

  return (
    <>
      <PageBackdrop />
      <main className="mx-auto flex w-full max-w-5xl flex-col px-6">
        <SiteHeader />
        <div className="flex flex-col gap-3 pb-10">
          <h1 className="font-semibold text-4xl tracking-tight">{CATALOG.heading}</h1>
          <p className="max-w-2xl text-balance text-lg text-muted-foreground">
            {CATALOG.description}
          </p>
        </div>

        <div className="pb-4">
          {/* The padding belongs out here: the icon centres on this box, and a bottom padding
              inside it is half that padding of drift downwards from the middle of the field. */}
          <div className="relative">
            <SearchIcon
              aria-hidden="true"
              className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={search}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search apps"
              aria-label="Search apps"
              className="h-11 pr-12 pl-10 font-mono text-sm"
            />
            <kbd className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md border border-border/60 px-1.5 py-0.5 font-mono text-muted-foreground text-xs">
              /
            </kbd>
          </div>
        </div>

        {/* A group rather than a list of links: the filter is page state, and a category that
            navigated would be a second address for a page that has not changed. */}
        <fieldset className="flex flex-wrap gap-2 pb-6">
          <legend className="sr-only">Filter by category</legend>
          {chips.map((name) => (
            <Link
              key={name}
              to="/apps"
              // The whole catalog carries no parameter at all, so the plain address is the one
              // that gets shared for it.
              search={{ category: name === ALL ? undefined : name }}
              data-selected={selected === name}
              // Matched on the search too, and exactly: every chip addresses this same path, so
              // anything less marks all of them as the current one — `All` included, whatever
              // the catalog is filtered to.
              activeOptions={{ exact: true, includeSearch: true }}
              className="group flex items-center gap-2 rounded-full border border-border/60 py-1 pr-2 pl-3 font-mono text-sm transition-colors hover:border-primary/60 hover:text-primary data-[selected=true]:border-primary data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground"
            >
              {name}
              {/* Tabular so the counts keep a column as chips light up, rather than the label
                  beside them shifting by a digit. */}
              <span className="rounded-full bg-muted/60 px-1.5 text-muted-foreground text-xs tabular-nums transition-colors group-data-[selected=true]:bg-primary-foreground/20 group-data-[selected=true]:text-primary-foreground">
                {counted(name)}
              </span>
            </Link>
          ))}
        </fieldset>

        {showRecommended && RECOMMENDED_APPS.length > 0 ? (
          <section aria-labelledby="recommended-heading" className="pb-10">
            <h2 id="recommended-heading" className="pb-4 font-semibold text-xl tracking-tight">
              Recommended
            </h2>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {RECOMMENDED_APPS.map((app) => (
                <AppCard key={app.slug} app={app} />
              ))}
            </ul>
          </section>
        ) : null}

        <div className="flex items-baseline justify-between gap-4 pb-8">
          {showRecommended ? (
            <h2 className="font-semibold text-xl tracking-tight">All apps</h2>
          ) : null}
          <p className="font-mono text-muted-foreground text-sm">
            <span className="text-foreground tabular-nums">{shown.length}</span>
            {shown.length === 1 ? ' app' : ' apps'}
            {shown.length === APPS.length ? null : (
              <>
                {' of '}
                <span className="tabular-nums">{APPS.length}</span>
              </>
            )}
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((app) => (
            <AppCard key={app.slug} app={app} />
          ))}
        </ul>

        {shown.length === 0 ? (
          <p className="py-16 text-center text-muted-foreground">
            Nothing matches that. Everything here ships a single Linux binary — if what you want
            does not,{' '}
            <a className="underline" href={WWW_DEPLOY_PATH}>
              deploy your own
            </a>
            .
          </p>
        ) : null}

        <div className="py-16 text-center text-muted-foreground text-sm">
          {/* Not a router link: the target is a file the worker hands back, not a route. */}
          <a className="underline" href={CATALOG.markdownPath}>
            This catalog in Markdown
          </a>
        </div>
      </main>
    </>
  );
}
