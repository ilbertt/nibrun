import type { ReactNode } from 'react';

const OFFERINGS: { name: string; detail: ReactNode }[] = [
  { name: 'A machine', detail: 'A Firecracker microVM of its own. Nothing else runs in it.' },
  {
    name: 'A disk',
    detail: (
      <>
        <code className="text-foreground">data/</code> is yours, and it survives every redeploy.
      </>
    ),
  },
  { name: 'A URL', detail: 'An HTTPS subdomain, the moment it boots.' },
  {
    name: 'A way out',
    detail: (
      <>
        One export: the binary, the disk, its <code className="text-foreground">.env</code>.
      </>
    ),
  },
];

export function WhatYourAppGets() {
  return (
    <section className="flex w-full flex-col gap-10 border-border/60 border-t py-16 sm:py-20">
      <h2 className="max-w-2xl font-semibold text-2xl tracking-tight sm:text-3xl">
        What your app gets on nibrun.
      </h2>
      <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {OFFERINGS.map(({ name, detail }) => (
          <li key={name} className="flex flex-col gap-2 border-border/60 border-t pt-4">
            <span className="font-medium">{name}</span>
            <span className="text-pretty text-muted-foreground text-sm">{detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
