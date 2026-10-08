import { SqliteExplorer } from '@repo/sqlite-explorer';
import { createFileRoute } from '@tanstack/react-router';
import { SiteHeader } from '#components/site-header.tsx';
import '@repo/sqlite-explorer/styles.css';
import { pageTitle } from '#lib/page-title.ts';

export const Route = createFileRoute('/sqlite-studio')({
  head: () => ({
    meta: [
      { title: pageTitle('SQLite Studio preview') },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <>
      <div className="mx-auto w-full max-w-5xl px-6">
        <SiteHeader />
      </div>
      <SqliteExplorer className="mx-4 mb-6 h-[calc(100svh-7rem)] min-h-[36rem]" />
    </>
  );
}
