import { WWW_SITE } from '@repo/global-constants';
import { createFileRoute } from '@tanstack/react-router';
import { BinaryDrop } from '#components/binary-drop.tsx';
import { DeployCta } from '#components/deploy-cta.tsx';
import { GetStartedHint } from '#components/get-started-hint.tsx';
import { Hero } from '#components/hero.tsx';
import { OpenSource } from '#components/open-source.tsx';
import { PageBackdrop } from '#components/page-backdrop.tsx';
import { Pricing } from '#components/pricing.tsx';
import { SiteHeader } from '#components/site-header.tsx';
import { TryItOut } from '#components/try-it-out.tsx';
import { WhatItActuallyNeeds } from '#components/what-it-actually-needs.tsx';
import { WhatYourAppGets } from '#components/what-your-app-gets.tsx';
import { pageHead } from '#lib/page-head.ts';

export const Route = createFileRoute('/')({
  head: () => pageHead({ path: '/', title: WWW_SITE.title, description: WWW_SITE.description }),
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
          <Hero />
          <div className="flex w-full flex-col items-center gap-6">
            <BinaryDrop />
            <TryItOut />
            <GetStartedHint />
          </div>
        </section>
        <WhatItActuallyNeeds />
        <WhatYourAppGets />
        <Pricing />
        <OpenSource />
        <DeployCta />
      </main>
    </>
  );
}
