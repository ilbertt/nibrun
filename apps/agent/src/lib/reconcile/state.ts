import type { ReportedVolume } from '@repo/protocol';

/** Rebuilt from what a reconcile found rather than added to, so what just happened to a volume wins. */
export function mergeVolumeReports({
  existing,
  updates,
}: {
  existing: readonly ReportedVolume[];
  updates: readonly ReportedVolume[];
}): ReportedVolume[] {
  const merged = new Map(existing.map((report) => [report.volumeId, report] as const));
  for (const report of updates) {
    merged.set(report.volumeId, report);
  }
  return [...merged.values()];
}
