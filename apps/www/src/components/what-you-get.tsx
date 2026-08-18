import { CpuIcon, DatabaseIcon, GlobeIcon, PackageIcon } from 'lucide-react';

const WHAT_YOU_GET = [
  {
    icon: CpuIcon,
    title: 'A machine to itself',
    body: 'One microVM per app. Your binary is the only thing running inside it, so nothing else can crash it or read its disk.',
  },
  {
    icon: DatabaseIcon,
    title: 'Just write to the disk',
    body: 'SQLite for your data, data/ for your uploads. No database to provision, no bucket to configure, and it survives every redeploy.',
  },
  {
    icon: PackageIcon,
    title: 'Take it all with you',
    body: 'One click, one .tar.gz: the binary and every byte of its disk, read while the filesystem is frozen so the SQLite inside is intact. Runs on any Linux box.',
  },
  {
    icon: GlobeIcon,
    title: 'A URL right away',
    body: 'An HTTPS subdomain, issued and served the moment it boots. Point a domain of your own at it when you are ready.',
  },
];

export function WhatYouGet() {
  return (
    <section className="grid w-full gap-10 border-border/60 border-t py-16 sm:grid-cols-2 sm:gap-8 sm:py-20 lg:grid-cols-4">
      {WHAT_YOU_GET.map(({ icon: Icon, title, body }) => (
        <div key={title} className="flex flex-col items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="size-5" />
          </span>
          <h2 className="text-balance font-medium">{title}</h2>
          <p className="text-pretty text-muted-foreground text-sm leading-relaxed">{body}</p>
        </div>
      ))}
    </section>
  );
}
