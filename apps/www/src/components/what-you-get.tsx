import { CpuIcon, DatabaseIcon, GlobeIcon, PackageIcon } from 'lucide-react';

const WHAT_YOU_GET = [
  {
    icon: CpuIcon,
    title: 'One guest, one volume',
    body: 'No orchestrator, no sidecars, no service mesh. Your binary is the only thing that ever executes in there.',
  },
  {
    icon: DatabaseIcon,
    title: 'SQLite is just a file',
    body: 'And so are your uploads. A real ext4 volume at data/ — nothing to provision, no connection string to keep.',
  },
  {
    icon: PackageIcon,
    title: 'Take it and go',
    body: 'One .tar.gz with the binary and everything on its volume, from a button. It runs anywhere Linux does.',
  },
  {
    icon: GlobeIcon,
    title: 'An HTTPS endpoint',
    body: 'Issued and served the moment it boots. No certificate to renew, no load balancer to stand up.',
  },
];

export function WhatYouGet() {
  return (
    <section className="grid w-full gap-10 border-border/60 border-t py-16 sm:grid-cols-2 sm:gap-8 sm:py-20 lg:grid-cols-4">
      {WHAT_YOU_GET.map(({ icon: Icon, title, body }) => (
        <div key={title} className="flex flex-col items-start gap-3">
          <Icon className="size-5 text-primary" />
          <h2 className="font-medium">{title}</h2>
          <p className="text-pretty text-muted-foreground text-sm leading-relaxed">{body}</p>
        </div>
      ))}
    </section>
  );
}
