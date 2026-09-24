import { createFileRoute } from '@tanstack/react-router';
import { PageBackdrop } from '#components/page-backdrop.tsx';
import { PricingCalculator } from '#components/pricing-calculator.tsx';
import { SiteHeader } from '#components/site-header.tsx';
import { pageHead } from '#lib/page-head.ts';
import { pageTitle } from '#lib/page-title.ts';

const TITLE = pageTitle('Calculator');
const SUBTITLE = 'Every app is a box.';
const DESCRIPTION =
  'Every app is a box. Grow its sides — vCPU, RAM, disk — and see what a room full of them costs.';

export const Route = createFileRoute('/calculator')({
  head: () => pageHead({ path: '/calculator', title: TITLE, description: DESCRIPTION }),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <>
      <PageBackdrop />
      <main className="mx-auto flex w-full max-w-5xl flex-col px-6 lg:h-dvh lg:overflow-hidden">
        <SiteHeader />
        <div className="flex max-w-2xl shrink-0 flex-col gap-3 pb-10">
          <h1 className="font-semibold text-4xl tracking-tight">Calculator</h1>
          <p className="text-pretty text-lg text-muted-foreground">{SUBTITLE}</p>
        </div>
        <PricingCalculator />
      </main>
    </>
  );
}
