const CEREMONY = [
  'A container image, around a single file',
  'A managed Postgres',
  'An object storage bucket',
  'A VM to ssh into',
  'A firewall to open',
  'TLS to renew',
  'An OS to keep updated',
];

const ESSENTIALS = ['A machine to run on', 'A disk to write to'];

export function WhatItActuallyNeeds() {
  return (
    <section className="flex w-full flex-col gap-10 border-border/60 border-t py-16 sm:py-20">
      <h2 className="max-w-2xl font-semibold text-2xl tracking-tight sm:text-3xl">
        A small app doesn&apos;t need infrastructure.
      </h2>
      <div className="grid gap-10 sm:grid-cols-2 sm:gap-0">
        <div className="flex flex-col gap-4 sm:pr-10">
          <h3 className="text-muted-foreground text-sm">What it usually gets</h3>
          <ul className="flex flex-col gap-3">
            {CEREMONY.map((item) => (
              <li
                key={item}
                className="text-muted-foreground/70 line-through decoration-2 decoration-destructive/70"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-4 sm:border-border/60 sm:border-l sm:pl-10 lg:pl-16">
          <h3 className="text-muted-foreground text-sm">What it actually needs</h3>
          <ul className="flex flex-col gap-3">
            {ESSENTIALS.map((item) => (
              <li key={item} className="font-medium text-lg text-primary">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
