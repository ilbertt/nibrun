import type { ReactNode } from 'react';
import { Section } from '#components/section.tsx';

const CEREMONY = [
  'A container image',
  'A managed Postgres',
  'An object storage bucket',
  'A load balancer, for one instance',
  'A build pipeline',
  'A YAML file you copied',
];

const ESSENTIALS: { name: string; detail: ReactNode }[] = [
  { name: 'A machine to run on', detail: 'One microVM per app. Nothing else runs in it.' },
  {
    name: 'A disk to write to',
    detail: (
      <>
        <code className="text-foreground">data/</code> is yours: a SQLite file, uploads, both. It
        survives every redeploy.
      </>
    ),
  },
  {
    name: 'A URL right away',
    detail: 'An HTTPS subdomain, the moment it boots. No DNS to point, no certificate to renew.',
  },
];

export function WhatItActuallyNeeds() {
  return (
    <Section title="For an app that five people use, most of this is ceremony.">
      <div className="grid gap-8 sm:grid-cols-2 sm:gap-0">
        <div className="flex flex-col gap-3 sm:pr-10">
          <ColumnLabel>What it usually gets</ColumnLabel>
          <ul className="flex flex-col gap-3">
            {CEREMONY.map((item) => (
              <li key={item} className="text-muted-foreground/70 line-through">
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3 sm:border-border/60 sm:border-l sm:pl-10 lg:pl-16">
          <ColumnLabel>What it actually needs</ColumnLabel>
          <ul className="flex flex-col gap-8">
            {ESSENTIALS.map(({ name, detail }) => (
              <li key={name} className="flex flex-col gap-3">
                <span className="font-medium text-primary">{name}</span>
                <span className="text-pretty text-muted-foreground">{detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="max-w-[65ch] text-pretty text-muted-foreground">
        A compiled binary is already the whole app as one file. nibrun gives that file the only two
        things it&apos;s still missing.
      </p>
    </Section>
  );
}

function ColumnLabel({ children }: { children: ReactNode }) {
  return <h3 className="text-muted-foreground text-sm">{children}</h3>;
}
