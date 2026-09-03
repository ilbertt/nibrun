import { FREE_APPS_COUNT, HELLO_EMAIL, PRICE_PER_APP_USD } from '@repo/global-constants';
import { DEFAULT_INSTANCE_RESOURCES, DEFAULT_VOLUME_SIZE_BYTES } from '@repo/protocol';
import { Button } from '@repo/ui/components/button';
import { CpuIcon, HardDriveIcon, MemoryStickIcon, MinusIcon, PlusIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';

const BYTES_PER_GIB = 1_073_741_824;

const MIN_APPS = 1;
const MAX_APPS = 20;

/** Past this many, the per-app price stops being the answer and a conversation is. */
const BULK_APP_THRESHOLD = 10;

/** What "bigger" starts at, so the second card moves with the machine rather than beside it. */
const BIGGER_MACHINE_FACTOR = 2;

const CONTACT_BODY = "Hi,\n\nI'd like to know more.\n\nThanks!";

// Percent-encoded rather than form-encoded: a mail client reads `+` in these as a plus sign
// rather than a space, so `URLSearchParams` would put one in every subject it wrote.
function contactUrl(subject: string) {
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(CONTACT_BODY)}`;
  return `mailto:${HELLO_EMAIL}?${query}`;
}

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

function MachineColumn({
  title,
  resources,
  note,
  action,
  className,
}: {
  title: string;
  resources: MachineResource[];
  note?: string;
  action: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex h-full flex-col gap-6 ${className}`}>
      <div className="flex flex-col gap-3">
        <span className="font-medium text-lg">{title}</span>
        <ul className="flex flex-col gap-2">
          {resources.map(({ icon: ResourceIcon, label }) => (
            <li key={label} className="flex items-center gap-2 text-muted-foreground text-sm">
              <ResourceIcon className="size-4 text-primary" />
              {label}
            </li>
          ))}
        </ul>
        {note && <span className="text-muted-foreground text-sm">{note}</span>}
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-4 border-border/60 border-t pt-6">
        {action}
      </div>
    </div>
  );
}

export function Pricing() {
  const [appCount, setAppCount] = useState(FREE_APPS_COUNT);
  const monthly = Math.max(0, appCount - FREE_APPS_COUNT) * PRICE_PER_APP_USD;

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
          First {FREE_APPS_COUNT} apps free. Forever.
        </h2>
        <span className="text-muted-foreground">Then ${PRICE_PER_APP_USD}/app, per month.</span>
      </div>
      <div className="grid gap-10 sm:grid-cols-2 sm:gap-0">
        <MachineColumn
          className="sm:pr-10"
          title="Your binary runs on"
          resources={STANDARD_RESOURCES}
          note="Managed. Isolated. Persistent disk. Unlimited exports."
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
                  href={contactUrl(`Volume pricing for ${appCount} apps`)}
                  className="flex h-9 items-center font-medium text-primary text-sm underline underline-offset-4"
                >
                  Contact us for a volume price
                </a>
              ) : (
                <span className="flex h-9 items-baseline gap-1.5">
                  <span className="font-semibold text-3xl text-primary tabular-nums tracking-tight">
                    {monthly === 0 ? 'Free' : `$${monthly}`}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {monthly === 0 ? 'forever' : '/month'}
                  </span>
                </span>
              )}
            </>
          }
        />
        <MachineColumn
          className="sm:border-border/60 sm:border-l sm:pl-10 lg:pl-16"
          title="Need a bigger machine?"
          resources={BIGGER_RESOURCES}
          action={
            <Button
              variant="outline"
              className="ml-auto h-9"
              render={<a href={contactUrl('A bigger machine')} />}
            >
              Contact us
            </Button>
          }
        />
      </div>
    </section>
  );
}
