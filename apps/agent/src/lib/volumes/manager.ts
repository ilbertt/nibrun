import type { ReportedVolume } from '@repo/protocol';
import type { ObservedVolume } from '#lib/reconcile/plan.ts';

/**
 * Derived from the observation rather than accumulated from provisioning, so a volume nobody
 * touched still reports itself — and a restarted agent does not report none while serving one.
 */
export function toReportedVolume(observed: ObservedVolume): ReportedVolume {
  return {
    volumeId: observed.volumeId,
    state: observed.attached ? 'ready' : 'detached',
    sizeBytes: observed.sizeBytes,
    storagePrefix: observed.storagePrefix,
    ...(observed.devicePath ? { devicePath: observed.devicePath } : {}),
  };
}
