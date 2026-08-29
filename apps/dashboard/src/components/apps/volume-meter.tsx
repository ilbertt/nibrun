import type { FilesystemUsage } from '@repo/protocol';
import { dayAndMinute } from '#lib/format-timestamp.ts';

const PERCENT_SCALE = 100;
const FULL = 1;

/**
 * How much of the volume is spoken for.
 *
 * Measured against the volume rather than against the filesystem's own size, which reads a little
 * under it — ext4 spends part of the device describing the rest, and 8 GiB is the number the app
 * was given.
 *
 * Said as a share as well as a size, because the size alone misleads: what is measured is what
 * `df` calls used, so it counts the journal ext4 wrote before the tenant existed, and a volume
 * nothing has been written to still reads as tens of mebibytes. As a percentage that is the 1% it
 * amounts to; as a byte count on its own it reads as data the owner does not remember putting
 * there. The moment is shown beside it because a reading can only be taken while a guest has the
 * filesystem mounted, so a suspended app's is as old as the app has been stopped.
 */
export function VolumeMeter({
  usage,
  volumeSizeBytes,
}: {
  usage: FilesystemUsage;
  volumeSizeBytes: number;
}) {
  const share = Math.min(usage.usedBytes / volumeSizeBytes, FULL);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={volumeSizeBytes}
        aria-valuenow={usage.usedBytes}
        aria-label="Volume used"
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${share * PERCENT_SCALE}%` }}
        />
      </div>
      <span className="text-muted-foreground text-xs">
        {Math.round(share * PERCENT_SCALE)}% used, including what the filesystem itself takes ·
        measured {dayAndMinute(usage.measuredAt)}
      </span>
    </div>
  );
}
