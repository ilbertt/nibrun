import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import { CpuIcon, HardDriveIcon, type LucideIcon, MemoryStickIcon } from 'lucide-react';
import { VolumeMeter } from '#components/apps/volume-meter.tsx';
import { formatBytes } from '#lib/format-bytes.ts';
import type { AppSummary } from '#queries/apps.ts';

const BYTES_PER_MIB = 1_048_576;

export function AppResourcesCard({ app }: { app: AppSummary }) {
  const { resources, volumeSizeBytes } = app.config;
  const usage = app.volumeUsage;

  const allocated: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: CpuIcon, label: 'vCPU', value: String(resources.vcpuCount) },
    {
      icon: MemoryStickIcon,
      label: 'Memory',
      value: formatBytes(resources.memoryMib * BYTES_PER_MIB),
    },
    {
      icon: HardDriveIcon,
      label: 'Volume',
      // What is allocated until a host has measured it, which it can only do from inside a
      // running guest — so an app that has never come up says how much it was given and no more.
      value: usage
        ? `${formatBytes(usage.usedBytes)} of ${formatBytes(volumeSizeBytes)}`
        : formatBytes(volumeSizeBytes),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resources</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {allocated.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Icon className="size-4 shrink-0" />
              {label}
            </span>
            <span className="font-mono tabular-nums">{value}</span>
          </div>
        ))}
        {usage ? <VolumeMeter usage={usage} volumeSizeBytes={volumeSizeBytes} /> : null}
      </CardContent>
    </Card>
  );
}
