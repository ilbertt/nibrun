import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import { CpuIcon, HardDriveIcon, MemoryStickIcon } from 'lucide-react';
import { ResourceMeter } from '#components/apps/resource-meter.tsx';
import { formatBytes } from '#lib/format-bytes.ts';
import type { AppSummary } from '#queries/apps.ts';

const BYTES_PER_MIB = 1_048_576;

/**
 * How much of each vCPU is being spent, rather than a percentage: the row beside it is a size out
 * of a size, and a share among sizes reads as a fourth unit rather than as the same question
 * asked again.
 */
const VCPU_DECIMALS = 2;

/**
 * What the app was given, and what it is using of it.
 *
 * Every reading is taken from inside the running guest, so an app that has never come up shows
 * what it was allocated and nothing against it — and one that has stopped keeps what was true
 * when it was last running, which is why every reading carries the moment it was taken.
 */
export function AppResourcesCard({ app }: { app: AppSummary }) {
  const { resources, volumeSizeBytes } = app.config;
  const compute = app.computeUsage;
  const volume = app.volumeUsage;
  const memoryBytes = resources.memoryMib * BYTES_PER_MIB;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resources</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <ResourceMeter
          icon={CpuIcon}
          label="vCPU"
          total={String(resources.vcpuCount)}
          note="Averaged across every vCPU over the minute before it was measured, so a moment of one core pinned does not show here."
          reading={
            compute?.cpuShare === undefined
              ? null
              : {
                  used: (compute.cpuShare * resources.vcpuCount).toFixed(VCPU_DECIMALS),
                  share: compute.cpuShare,
                  measuredAt: compute.measuredAt,
                }
          }
        />
        <ResourceMeter
          icon={MemoryStickIcon}
          label="Memory"
          total={formatBytes(memoryBytes)}
          note="Cache the kernel hands back the moment anything asks for it is not counted as used."
          reading={
            compute
              ? {
                  used: formatBytes(compute.memoryUsedBytes),
                  share: compute.memoryUsedBytes / memoryBytes,
                  measuredAt: compute.measuredAt,
                }
              : null
          }
        />
        <ResourceMeter
          icon={HardDriveIcon}
          label="Volume"
          total={formatBytes(volumeSizeBytes)}
          note="Counts what the filesystem itself takes, so a volume nothing has ever written to is not empty."
          reading={
            volume
              ? {
                  used: formatBytes(volume.usedBytes),
                  share: volume.usedBytes / volumeSizeBytes,
                  measuredAt: volume.measuredAt,
                }
              : null
          }
        />
      </CardContent>
    </Card>
  );
}
