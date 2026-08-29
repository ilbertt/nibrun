import type { DeployLink } from '@repo/deploy-link';
import { Button } from '@repo/ui/components/button';
import { BrandMark } from '@repo/ui/custom/brand-mark';
import { createFileRoute, defaultStringifySearch, notFound } from '@tanstack/react-router';
import { PageBackdrop } from '#components/page-backdrop.tsx';
import { findPreset } from '#deploy-presets.ts';
import { APP_ORIGIN } from '#lib/app-origin.ts';
import { pageTitle } from '#lib/site.ts';

/**
 * Written by the same router that reads it on the far side, rather than by hand: the deploy screen
 * takes its search back apart with `JSON.parse`, so a value spelled out here would be a value it
 * read as something other than what the preset holds.
 */
function deployUrl(preset: DeployLink): string {
  return `${APP_ORIGIN}/deploy${defaultStringifySearch(preset)}`;
}

export const Route = createFileRoute('/deploy/$slug')({
  loader: ({ params }) => {
    if (findPreset(params.slug) === undefined) {
      throw notFound();
    }
  },
  head: ({ params }) => {
    const preset = findPreset(params.slug);
    if (preset === undefined) {
      return {};
    }

    return {
      meta: [
        { title: pageTitle(`Deploy ${params.slug}`) },
        // The redirect itself, so a prerendered file at the edge forwards without a worker and
        // without javascript. A zero delay is a replacement rather than a stop, which keeps the
        // page out of the history the back button walks.
        { httpEquiv: 'refresh', content: `0; url=${deployUrl(preset)}` },
        { name: 'robots', content: 'noindex' },
      ],
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  const preset = findPreset(slug);
  if (preset === undefined) {
    return null;
  }

  return (
    <>
      <PageBackdrop />
      <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
        <BrandMark />
        <p className="text-muted-foreground">Taking you to the nibrun deploy screen…</p>
        {/* The whole of the fallback: a refresh a browser or an extension declined to follow is
            still one click from where it was going. */}
        <Button render={<a href={deployUrl(preset)} />}>Continue</Button>
      </main>
    </>
  );
}
