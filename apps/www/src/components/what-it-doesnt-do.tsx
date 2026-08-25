export function WhatItDoesntDo() {
  return (
    <section className="flex w-full flex-col gap-4 border-border/60 border-t py-16 sm:py-20">
      <h2 className="font-semibold text-2xl tracking-tight">What it doesn&apos;t do</h2>
      <p className="max-w-2xl text-pretty text-muted-foreground">
        One instance per app, single writer. No autoscaling, no load balancing, no multi-region. If
        your app needs those, it has outgrown this and you should use something else.
      </p>
      <p className="max-w-2xl text-pretty">That&apos;s not a roadmap. It&apos;s the design.</p>
    </section>
  );
}
