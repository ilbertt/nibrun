import { BrandMark } from '@repo/ui/custom/brand-mark';
import { createFileRoute } from '@tanstack/react-router';
import { BinaryDrop } from '#components/binary-drop.tsx';
import { Hero } from '#components/hero.tsx';
import { PageBackdrop } from '#components/page-backdrop.tsx';
import { TerminalHint } from '#components/terminal-hint.tsx';
import { WhatYouGet } from '#components/what-you-get.tsx';

export const Route = createFileRoute('/')({ component: RouteComponent });

function RouteComponent() {
  return (
    <>
      <PageBackdrop />
      <main className="mx-auto flex w-full max-w-5xl flex-col items-center px-6">
        {/* Short of the viewport on purpose: the section below has to peek, or nobody scrolls. */}
        <section className="flex min-h-[85svh] w-full max-w-xl flex-col items-center justify-center gap-12 py-16">
          <div className="flex flex-col items-center gap-6">
            <BrandMark />
            <Hero />
          </div>
          <div className="flex w-full flex-col items-center gap-4">
            <BinaryDrop />
            <TerminalHint />
          </div>
        </section>
        <WhatYouGet />
      </main>
    </>
  );
}
