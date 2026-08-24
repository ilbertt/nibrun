import { BrandMark } from '@repo/ui/custom/brand-mark';
import { createFileRoute } from '@tanstack/react-router';
import { BinaryDrop } from '#components/binary-drop.tsx';
import { DashboardLink } from '#components/dashboard-link.tsx';
import { GetStartedHints } from '#components/get-started-hints.tsx';
import { GithubLink } from '#components/github-link.tsx';
import { Hero } from '#components/hero.tsx';
import { PageBackdrop } from '#components/page-backdrop.tsx';
import { TryItOut } from '#components/try-it-out.tsx';
import { WhatYouGet } from '#components/what-you-get.tsx';

export const Route = createFileRoute('/')({ component: RouteComponent });

function RouteComponent() {
  return (
    <>
      <PageBackdrop />
      <main className="mx-auto flex w-full max-w-5xl flex-col items-center px-6">
        <header className="flex w-full items-center justify-end gap-1 py-5">
          <GithubLink />
          <DashboardLink />
        </header>
        {/* Short of the viewport on purpose: the section below has to peek, or nobody scrolls. */}
        <section className="flex min-h-[78svh] w-full max-w-xl flex-col items-center justify-center gap-12 pb-16">
          <div className="flex flex-col items-center gap-6">
            <BrandMark />
            <Hero />
          </div>
          <div className="flex w-full flex-col items-center gap-6">
            <BinaryDrop />
            <TryItOut />
            <GetStartedHints />
          </div>
        </section>
        <WhatYouGet />
      </main>
    </>
  );
}
