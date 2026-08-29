import { DEFAULT_INSTANCE_RESOURCES, DEFAULT_VOLUME_SIZE_BYTES } from '@repo/protocol';

const BYTES_PER_GIB = 1_073_741_824;

const MACHINE_SPEC = [
  `${DEFAULT_INSTANCE_RESOURCES.vcpuCount} vCPU`,
  `${DEFAULT_INSTANCE_RESOURCES.memoryMib} MB`,
  `${DEFAULT_VOLUME_SIZE_BYTES / BYTES_PER_GIB} GB disk`,
].join(' · ');

const TIERS = [
  {
    name: 'Your first app',
    price: 'Free, forever',
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
    <section className="flex w-full flex-col gap-10 border-border/60 border-t py-16 sm:py-20">
      <div className="flex max-w-2xl flex-col gap-4">
        <h2 className="font-semibold text-2xl tracking-tight sm:text-3xl">
          Your first app is free. Forever.
        </h2>
        <p className="text-pretty text-muted-foreground">
          Every app gets the same machine — <span className="text-foreground">{MACHINE_SPEC}</span>{' '}
          — so there is only one thing here to price.
        </p>
      </div>
      <ul className="grid gap-8 sm:grid-cols-2">
        {TIERS.map(({ name, price, detail }) => (
          <li key={name} className="flex flex-col gap-2 border-border/60 border-t pt-4">
            <span className="text-muted-foreground text-sm">{name}</span>
            <span className="font-medium text-lg text-primary">{price}</span>
            <span className="text-pretty text-muted-foreground text-sm">{detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
