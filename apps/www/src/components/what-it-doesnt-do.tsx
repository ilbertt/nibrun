import { Section } from '#components/section.tsx';

export function WhatItDoesntDo() {
  return (
    <Section title="What it doesn't do">
      <div className="flex max-w-[65ch] flex-col gap-3 text-muted-foreground">
        <p className="text-pretty">
          One instance per app, one writer. If your app has to be several machines, it has outgrown
          this and you should use something else.
        </p>
        <p className="text-pretty">That&apos;s not a roadmap. It&apos;s the design.</p>
      </div>
    </Section>
  );
}
