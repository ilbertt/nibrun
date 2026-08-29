import type { UploadProgress } from '@repo/app-operations';
import { formatBytes } from '#lib/format-bytes.ts';

const PERCENT_SCALE = 100;

export function UploadMeter({ progress }: { progress: UploadProgress }) {
  const share = progress.sentBytes / progress.totalBytes;

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.totalBytes}
        aria-valuenow={progress.sentBytes}
        aria-label="Upload progress"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${share * PERCENT_SCALE}%` }}
        />
      </div>
      <span className="text-xs tabular-nums">
        {formatBytes(progress.sentBytes)} of {formatBytes(progress.totalBytes)}
      </span>
    </div>
  );
}
