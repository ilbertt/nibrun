import type { UploadProgress } from '@repo/app-operations';
import { CellBar } from '@repo/ui/custom/cell-bar';
import { formatBytes } from '#lib/format-bytes.ts';

export function UploadMeter({ progress }: { progress: UploadProgress }) {
  return (
    <div className="flex flex-col gap-1.5">
      <CellBar
        share={progress.sentBytes / progress.totalBytes}
        tone="bg-primary text-primary"
        label="Upload progress"
        rounded={false}
      />
      <span className="text-xs tabular-nums">
        {formatBytes(progress.sentBytes)} of {formatBytes(progress.totalBytes)}
      </span>
    </div>
  );
}
