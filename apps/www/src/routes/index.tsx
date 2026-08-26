import { BrandMark } from '@repo/ui/custom/brand-mark';
import { createFileRoute } from '@tanstack/react-router';
import { BinaryDrop } from '#components/binary-drop.tsx';
import { DeployCta } from '#components/deploy-cta.tsx';
import { GetStartedHint } from '#components/get-started-hint.tsx';
import { Hero } from '#components/hero.tsx';
import { PageBackdrop } from '#components/page-backdrop.tsx';
import { SiteHeader } from '#components/site-header.tsx';
import { TryItOut } from '#components/try-it-out.tsx';
import { WhatItActuallyNeeds } from '#components/what-it-actually-needs.tsx';
import { pageHead } from '#lib/page-head.ts';
import { SITE_DESCRIPTION, SITE_TITLE } from '#lib/site.ts';

export const Route = createFileRoute('/')({
  head: () => pageHead({ path: '/', title: SITE_TITLE, description: SITE_DESCRIPTION }),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <>
      <PageBackdrop />
      <main className="mx-auto flex w-full max-w-5xl flex-col items-center px-6">
        <SiteHeader />
        {/* Short of the viewport on purpose: the section below has to peek, or nobody scrolls. */}
        <section className="flex min-h-[78svh] w-full max-w-xl flex-col items-center justify-center gap-12 pb-16">
          <div className="flex flex-col items-center gap-6">
            <BrandMark />
            <Hero />
          </div>
          <div className="flex w-full flex-col items-center gap-6">
            <BinaryDrop />
            <TryItOut />
            <GetStartedHint />
          </div>
        </section>
        <WhatItActuallyNeeds />
        <DeployCta />
      </main>
    </>
  );
}
