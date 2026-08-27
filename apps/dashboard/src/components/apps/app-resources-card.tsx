import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import { CpuIcon, HardDriveIcon, type LucideIcon, MemoryStickIcon } from 'lucide-react';
import { formatBytes } from '#lib/format-bytes.ts';
import type { AppSummary } from '#queries/apps.ts';

const BYTES_PER_MIB = 1_048_576;

export function AppResourcesCard({ app }: { app: AppSummary }) {
  const { resources, volumeSizeBytes } = app.config;

  const allocated: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: CpuIcon, label: 'vCPU', value: String(resources.vcpuCount) },
    {
      icon: MemoryStickIcon,
      label: 'Memory',
      value: formatBytes(resources.memoryMib * BYTES_PER_MIB),
    },
    { icon: HardDriveIcon, label: 'Volume', value: formatBytes(volumeSizeBytes) },
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
      </CardContent>
    </Card>
  );
}
