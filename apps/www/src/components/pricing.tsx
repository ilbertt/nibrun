import { DEFAULT_INSTANCE_RESOURCES, DEFAULT_VOLUME_SIZE_BYTES } from '@repo/protocol';
import { PlusIcon, ServerIcon } from 'lucide-react';
import { REPO_URL } from '#lib/site.ts';

const BYTES_PER_GIB = 1_073_741_824;

const FREE_APP_LIMIT = 3;

const PRICE_PER_APP_USD = 1;

const CONTACT_URL = `${REPO_URL}/issues/new`;

const MACHINE_SPEC = [
  `${DEFAULT_INSTANCE_RESOURCES.vcpuCount} vCPU`,
  `${DEFAULT_INSTANCE_RESOURCES.memoryMib} MB`,
  `${DEFAULT_VOLUME_SIZE_BYTES / BYTES_PER_GIB} GB disk`,
].join(' · ');

const FREE_MACHINES = [...Array(FREE_APP_LIMIT).keys()].map((index) => `machine-${index + 1}`);

const MACHINE_BOX = 'flex size-20 items-center justify-center rounded-xl border border-border/60';

export function Pricing() {
  return (
    <section
      id="pricing"
      className="flex w-full flex-col gap-10 border-border/60 border-t py-16 sm:py-20"
    >
      <h2 className="max-w-2xl font-semibold text-2xl tracking-tight sm:text-3xl">
        Your first {FREE_APP_LIMIT} apps are free. Forever.
      </h2>
      <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            {FREE_MACHINES.map((machine) => (
              <div key={machine} className={`${MACHINE_BOX} bg-card`}>
                <ServerIcon className="size-6 text-primary" />
              </div>
            ))}
          </div>
          <span className="font-medium text-lg text-primary">Free forever</span>
        </div>
        <div className="flex flex-col gap-3">
          <div className={`${MACHINE_BOX} border-dashed`}>
            <PlusIcon className="size-6 text-muted-foreground" />
          </div>
          <span className="font-medium text-lg">${PRICE_PER_APP_USD} a month</span>
        </div>
      </div>
      <span className="text-muted-foreground text-sm">
        One box is one app, on a machine of its own:{' '}
        <span className="text-foreground">{MACHINE_SPEC}</span>. Need more?{' '}
        <a
          href={CONTACT_URL}
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline underline-offset-4"
        >
          Contact us
        </a>
      </span>
    </section>
  );
}
