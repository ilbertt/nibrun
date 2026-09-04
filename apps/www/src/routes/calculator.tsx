import { DEFAULT_INSTANCE_RESOURCES } from '@repo/protocol';
import { createFileRoute } from '@tanstack/react-router';
import { PageBackdrop } from '#components/page-backdrop.tsx';
import { PricingCalculator } from '#components/pricing-calculator.tsx';
import { SiteHeader } from '#components/site-header.tsx';
import { AXES } from '#lib/calculator.ts';
import { contactUrl } from '#lib/contact.ts';
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

const SHIPPED_MACHINE = [
  `${DEFAULT_INSTANCE_RESOURCES.vcpuCount} ${AXES.vcpu.name}`,
  AXES.memory.format(DEFAULT_INSTANCE_RESOURCES.memoryMib),
  `${AXES.volume.format(AXES.volume.steps[0]!)} ${AXES.volume.name}`,
].join(', ');

function RouteComponent() {
  return (
    <>
      <PageBackdrop />
      <main className="mx-auto flex w-full max-w-5xl flex-col px-6 pb-24">
        <SiteHeader />
        <div className="flex max-w-2xl flex-col gap-3 pb-12">
          <h1 className="font-semibold text-4xl tracking-tight">Calculator</h1>
          <p className="text-pretty text-lg text-muted-foreground">{SUBTITLE}</p>
        </div>
        <PricingCalculator />
        <p className="max-w-2xl text-pretty pt-14 text-muted-foreground text-sm">
          Only the smallest box is self-serve today — every app gets {SHIPPED_MACHINE}, and the rest
          of the room is us being optimistic.{' '}
          <a
            href={contactUrl('A bigger box')}
            className="text-primary underline underline-offset-4"
          >
            Ask for a bigger one
          </a>{' '}
          and we will sort it out by hand, like it is 2004.
        </p>
      </main>
    </>
  );
}
