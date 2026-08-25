import { FileX2Icon, GlobeIcon, ServerIcon } from 'lucide-react';

const WHAT_YOU_GET = [
  {
    icon: ServerIcon,
    title: 'A machine of its own, and a disk that stays',
    body: 'One microVM per app. Nothing else runs in it. data/ is yours: a SQLite file, uploads, both. It survives every redeploy.',
  },
  {
    icon: GlobeIcon,
    title: 'A URL right away',
    body: 'An HTTPS subdomain, the moment it boots. No DNS to point, no certificate to renew.',
  },
  {
    icon: FileX2Icon,
    title: 'Nothing to configure',
    body: 'No Dockerfile. No YAML. No cluster. You upload the binary you already built.',
  },
];

export function WhatYouGet() {
  return (
    <section className="grid w-full gap-10 border-border/60 border-t py-16 sm:grid-cols-3 sm:grid-rows-[auto_auto_auto] sm:gap-x-10 sm:gap-y-3 sm:py-20">
      {WHAT_YOU_GET.map(({ icon: Icon, title, body }) => (
        // Subgrid so a title that wraps to two lines does not push its own body below the others'.
        <div key={title} className="flex flex-col gap-3 sm:row-span-3 sm:grid sm:grid-rows-subgrid">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="size-5" />
          </span>
          <h2 className="text-balance font-medium text-lg">{title}</h2>
          <p className="text-pretty text-muted-foreground">{body}</p>
        </div>
      ))}
    </section>
  );
}
