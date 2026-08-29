import { DEFAULT_INSTANCE_RESOURCES, DEFAULT_VOLUME_SIZE_BYTES } from '@repo/protocol';

const BYTES_PER_GIB = 1_073_741_824;

const FREE_APP_LIMIT = 3;

const MACHINE_SPEC = [
  `${DEFAULT_INSTANCE_RESOURCES.vcpuCount} vCPU`,
  `${DEFAULT_INSTANCE_RESOURCES.memoryMib} MB`,
  `${DEFAULT_VOLUME_SIZE_BYTES / BYTES_PER_GIB} GB disk`,
].join(' · ');

const TIERS: { name: string; price: string; detail: string; machine?: string }[] = [
  {
    name: `Your first ${FREE_APP_LIMIT} apps`,
    price: 'Free, forever',
    machine: MACHINE_SPEC,
    detail: 'No card to start, and no trial clock counting down behind it.',
  },
  {
    name: 'Every app after that',
    price: 'A flat monthly price',
    detail: "We haven't settled the number yet. It lands here before anyone is charged.",
  },
];

export function Pricing() {
  return (
    <section
      id="pricing"
      className="flex w-full flex-col gap-10 border-border/60 border-t py-16 sm:py-20"
    >
      <h2 className="max-w-2xl font-semibold text-2xl tracking-tight sm:text-3xl">
        Your first {FREE_APP_LIMIT} apps are free. Forever.
      </h2>
      <ul className="grid gap-8 sm:grid-cols-2">
        {TIERS.map(({ name, price, machine, detail }) => (
          <li key={name} className="flex flex-col gap-2 border-border/60 border-t pt-4">
            <span className="text-muted-foreground text-sm">{name}</span>
            <span className="font-medium text-lg text-primary">{price}</span>
            {machine ? (
              <span className="text-muted-foreground text-sm">
                Each app gets: <span className="text-foreground">{machine}</span>
              </span>
            ) : null}
            <span className="text-pretty text-muted-foreground text-sm">{detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
