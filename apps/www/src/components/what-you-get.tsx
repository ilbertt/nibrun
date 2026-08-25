import { CpuIcon, DatabaseIcon, GlobeIcon, PackageIcon } from 'lucide-react';

const WHAT_YOU_GET = [
  {
    icon: CpuIcon,
    title: 'A machine to itself',
    body: 'One microVM per app. Nothing else runs in it.',
  },
  {
    icon: DatabaseIcon,
    title: 'Just write to the disk',
    body: 'data/ is yours: a SQLite file, uploads, both. It survives every redeploy.',
  },
  {
    icon: PackageIcon,
    title: 'Take it all with you',
    body: 'One click: the binary, its whole disk and its .env, as one .tar.gz.',
  },
  {
    icon: GlobeIcon,
    title: 'A URL right away',
    body: 'An HTTPS subdomain, the moment it boots.',
  },
];

export function WhatYouGet() {
  return (
    <section className="grid w-full gap-8 border-border/60 border-t py-16 sm:grid-cols-2 sm:gap-x-16 sm:gap-y-12 sm:py-20">
      {WHAT_YOU_GET.map(({ icon: Icon, title, body }) => (
        <div key={title} className="flex items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="size-5" />
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="font-medium text-lg">{title}</h2>
            <p className="text-pretty text-muted-foreground">{body}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
