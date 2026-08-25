import { CpuIcon, DatabaseIcon, GlobeIcon, PackageIcon } from 'lucide-react';
import type { ReactNode } from 'react';

const CEREMONY = [
  'A container image',
  'A managed Postgres',
  'An object storage bucket',
  'A load balancer, for one instance',
  'A build pipeline',
  'A YAML file you copied',
];

const ESSENTIALS: { icon: typeof CpuIcon; name: string; detail: ReactNode }[] = [
  {
    icon: CpuIcon,
    name: 'A machine to run on',
    detail: 'One microVM per app. Nothing else runs in it.',
  },
  {
    icon: DatabaseIcon,
    name: 'A disk to write to',
    detail: (
      <>
        <code className="text-foreground">data/</code> is yours: a SQLite file, uploads, both. It
        survives every redeploy.
      </>
    ),
  },
  {
    icon: GlobeIcon,
    name: 'A URL right away',
    detail: 'An HTTPS subdomain, the moment it boots. No DNS to point, no certificate to renew.',
  },
  {
    icon: PackageIcon,
    name: 'A way out',
    detail:
      "One click gives you the binary and the entire disk. There's no managed database to migrate off, because there was never a managed database.",
  },
];

export function WhatItActuallyNeeds() {
  return (
    <section className="flex w-full flex-col gap-10 border-border/60 border-t py-16 sm:py-20">
      <div className="flex max-w-2xl flex-col gap-4">
        <h2 className="font-semibold text-2xl tracking-tight sm:text-3xl">
          A small app doesn&apos;t need infrastructure.
        </h2>
        <p className="text-pretty text-muted-foreground">
          A compiled binary is already the whole app as one file. nibrun gives that file what
          it&apos;s still missing.
        </p>
      </div>
      <div className="grid gap-10 sm:grid-cols-2 sm:gap-0">
        <div className="flex flex-col gap-4 sm:pr-10">
          <h3 className="text-muted-foreground text-sm">What it usually gets</h3>
          {/* Distributed rather than stacked: six one-line entries against four that each carry a
              paragraph would otherwise leave the struck column bunched at the top of a much taller
              row. The bottom inset gives the distribution less room to spread across, since
              matching the row exactly pushed the entries far enough apart to stop reading as one
              list — and it goes at the bottom so the label above stays attached to its first entry.
              The gap is the floor for when the two columns stack. */}
          <ul className="flex flex-1 flex-col justify-between gap-4 sm:pb-28">
            {CEREMONY.map((item) => (
              <li key={item} className="text-muted-foreground/70 line-through">
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-4 sm:border-border/60 sm:border-l sm:pl-10 lg:pl-16">
          <h3 className="text-muted-foreground text-sm">What it actually needs</h3>
          <ul className="flex flex-col gap-6">
            {ESSENTIALS.map(({ icon: Icon, name, detail }) => (
              <li key={name} className="flex items-start gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{name}</span>
                  <span className="text-pretty text-muted-foreground">{detail}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
