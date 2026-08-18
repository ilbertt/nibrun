import { CpuIcon, GlobeIcon, HardDriveIcon } from 'lucide-react';

const WHAT_YOU_GET = [
  {
    icon: CpuIcon,
    title: 'A machine of its own',
    body: 'One microVM per app. Its PID 1 measures 1.3 MiB of memory and 69 KiB on disk, and your binary is the only other thing that ever runs in there.',
  },
  {
    icon: HardDriveIcon,
    title: 'A volume that outlives deploys',
    body: 'Mounted at data/, kept across restarts and redeploys. Export the whole filesystem whenever you want it somewhere else.',
  },
  {
    icon: GlobeIcon,
    title: 'A hostname as soon as it boots',
    body: 'nibrun issues a subdomain and serves it over HTTPS. Point a domain of your own at it whenever you are ready.',
  },
];

export function WhatYouGet() {
  return (
    <section className="grid w-full gap-10 border-border/60 border-t py-16 sm:grid-cols-3 sm:gap-8 sm:py-20">
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
