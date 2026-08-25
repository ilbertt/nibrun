import { CheckIcon, XIcon } from 'lucide-react';

const CEREMONY = [
  'A container image',
  'A managed Postgres',
  'An object storage bucket',
  'A load balancer, for one instance',
  'A build pipeline',
  'A YAML file you copied',
];

const ESSENTIALS = ['A machine to run on', 'A disk to write to'];

export function WhatItActuallyNeeds() {
  return (
    <section className="flex w-full flex-col gap-10 border-border/60 border-t py-16 sm:py-20">
      <h2 className="max-w-3xl font-semibold text-2xl tracking-tight sm:text-3xl">
        For an app that five people use, most of this is ceremony.
      </h2>
      <div className="grid gap-10 sm:grid-cols-2 sm:gap-0">
        <div className="flex flex-col gap-4 sm:pr-10">
          <h3 className="text-muted-foreground text-sm">What you&apos;re asked to bring</h3>
          <ul className="flex flex-col gap-2.5">
            {CEREMONY.map((item) => (
              <li key={item} className="flex items-start gap-3 text-muted-foreground/70">
                <XIcon className="mt-1 size-4 shrink-0" />
                <span className="line-through decoration-muted-foreground/50">{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-4 sm:border-border/60 sm:border-l sm:pl-10 lg:pl-16">
          <h3 className="text-muted-foreground text-sm">What it actually needs</h3>
          <ul className="flex flex-col gap-2.5">
            {ESSENTIALS.map((item) => (
              <li key={item} className="flex items-start gap-3 font-medium text-lg">
                <CheckIcon className="mt-1 size-5 shrink-0 text-primary" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="max-w-2xl text-pretty text-muted-foreground">
        <code className="font-mono text-foreground">bun build --compile</code> already gives you the
        whole app as one file. nibrun gives that file the only two things it&apos;s still missing.
      </p>
    </section>
  );
}
