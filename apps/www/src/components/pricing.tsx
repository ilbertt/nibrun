import { DEFAULT_INSTANCE_RESOURCES, DEFAULT_VOLUME_SIZE_BYTES } from '@repo/protocol';
import { Button } from '@repo/ui/components/button';
import {
  CpuIcon,
  HardDriveIcon,
  MemoryStickIcon,
  MinusIcon,
  PlusIcon,
  ServerCogIcon,
  ServerIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { REPO_URL } from '#lib/site.ts';

const BYTES_PER_GIB = 1_073_741_824;

const FREE_APP_LIMIT = 3;

const PRICE_PER_APP_USD = 1;

const MIN_APPS = 1;
const MAX_APPS = 20;

/** Past this many, the per-app price stops being the answer and a conversation is. */
const BULK_APP_THRESHOLD = 10;

/** What "bigger" starts at, so the second card moves with the machine rather than beside it. */
const BIGGER_MACHINE_FACTOR = 2;

const CONTACT_URL = `${REPO_URL}/issues/new`;

const VOLUME_GIB = DEFAULT_VOLUME_SIZE_BYTES / BYTES_PER_GIB;

type MachineResource = { icon: typeof CpuIcon; label: string };

const STANDARD_RESOURCES: MachineResource[] = [
  { icon: CpuIcon, label: `${DEFAULT_INSTANCE_RESOURCES.vcpuCount} vCPU` },
  { icon: MemoryStickIcon, label: `${DEFAULT_INSTANCE_RESOURCES.memoryMib} MB memory` },
  { icon: HardDriveIcon, label: `${VOLUME_GIB} GB disk` },
];

const BIGGER_RESOURCES: MachineResource[] = [
  { icon: CpuIcon, label: `${DEFAULT_INSTANCE_RESOURCES.vcpuCount * BIGGER_MACHINE_FACTOR}+ vCPU` },
  {
    icon: MemoryStickIcon,
    label: `${DEFAULT_INSTANCE_RESOURCES.memoryMib * BIGGER_MACHINE_FACTOR}+ MB memory`,
  },
  { icon: HardDriveIcon, label: `${VOLUME_GIB * BIGGER_MACHINE_FACTOR}+ GB disk` },
];

function MachineCard({
  icon: Icon,
  title,
  resources,
  note,
  action,
}: {
  icon: typeof ServerIcon;
  title: string;
  resources: MachineResource[];
  note?: string;
  action: ReactNode;
}) {
  return (
    <div className="grid gap-8 rounded-2xl border border-border/60 p-6 sm:grid-cols-[auto_1fr] sm:gap-10 sm:p-8">
      <div className="flex h-32 w-full items-center justify-center rounded-xl bg-muted/40 sm:size-44">
        <Icon className="size-16 text-primary" strokeWidth={1.25} />
      </div>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <span className="font-medium text-lg">{title}</span>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {resources.map(({ icon: ResourceIcon, label }) => (
              <li key={label} className="flex items-center gap-2 text-muted-foreground text-sm">
                <ResourceIcon className="size-4 text-primary" />
                {label}
              </li>
            ))}
          </ul>
          {note && <span className="text-muted-foreground text-sm">{note}</span>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-border/60 border-t pt-6">
          {action}
        </div>
      </div>
    </div>
  );
}

export function Pricing() {
  const [appCount, setAppCount] = useState(FREE_APP_LIMIT);
  const monthly = Math.max(0, appCount - FREE_APP_LIMIT) * PRICE_PER_APP_USD;

  function fewer() {
    setAppCount((count) => Math.max(MIN_APPS, count - 1));
  }

  function more() {
    setAppCount((count) => Math.min(MAX_APPS, count + 1));
  }

  return (
    <section
      id="pricing"
      className="flex w-full flex-col gap-10 border-border/60 border-t py-16 sm:py-20"
    >
      <div className="flex max-w-2xl flex-col gap-3">
        <h2 className="font-semibold text-2xl tracking-tight sm:text-3xl">
          Your first {FREE_APP_LIMIT} apps are free. Forever.
        </h2>
        <span className="text-muted-foreground">Then ${PRICE_PER_APP_USD}/app, per month.</span>
      </div>
      <div className="flex flex-col gap-4">
        <MachineCard
          icon={ServerIcon}
          title="One machine per app"
          resources={STANDARD_RESOURCES}
          note="Isolated. Persistent disk, nothing to back up."
          action={
            <>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="icon-sm" onClick={fewer} aria-label="One app fewer">
                  <MinusIcon />
                </Button>
                <span className="min-w-16 text-center font-medium tabular-nums">
                  {appCount} app{appCount === 1 ? '' : 's'}
                </span>
                <Button variant="outline" size="icon-sm" onClick={more} aria-label="One app more">
                  <PlusIcon />
                </Button>
              </div>
              {appCount > BULK_APP_THRESHOLD ? (
                <a
                  href={CONTACT_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary text-sm underline underline-offset-4"
                >
                  Contact us for a volume price
                </a>
              ) : (
                <span className="flex items-baseline gap-1.5">
                  <span className="font-semibold text-3xl text-primary tabular-nums tracking-tight">
                    {monthly === 0 ? 'Free' : `$${monthly}`}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {monthly === 0 ? 'forever' : 'a month'}
                  </span>
                </span>
              )}
            </>
          }
        />
        <MachineCard
          icon={ServerCogIcon}
          title="Need a bigger machine?"
          resources={BIGGER_RESOURCES}
          action={
            <Button
              variant="outline"
              render={<a href={CONTACT_URL} target="_blank" rel="noreferrer" />}
            >
              Contact us
            </Button>
          }
        />
      </div>
    </section>
  );
}
