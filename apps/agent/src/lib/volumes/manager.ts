import type { ReportedVolume } from '@repo/protocol';
import type { ObservedVolume } from '#lib/reconcile/plan.ts';

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Structural, like `readInstanceRecords`: this is the agent's own note of what it removed. */
const isDeletedVolume = (value: unknown): value is ReportedVolume =>
  isObject(value) &&
  typeof value.volumeId === 'string' &&
  typeof value.appId === 'string' &&
  value.state === 'deleted';

/**
 * Deletions this host carried out and the control plane has not yet acknowledged.
 *
 * Kept across a restart because the removal is not re-derivable: the device file is gone, so the
 * next observation sees nothing, and nothing is exactly what an app whose filesystem lives on
 * another host looks like. Only the host that did the removal can say it happened.
 */
export function readDeletedVolumes(value: unknown): ReportedVolume[] {
  return Array.isArray(value) ? value.filter(isDeletedVolume) : [];
}

/**
 * Derived from the observation rather than accumulated from provisioning, so a volume nobody
 * touched still reports itself — and a restarted agent does not report none while serving one.
 */
export function toReportedVolume(observed: ObservedVolume): ReportedVolume {
  return {
    volumeId: observed.volumeId,
    appId: observed.appId,
    state: observed.attached ? 'ready' : 'detached',
    sizeBytes: observed.sizeBytes,
    storagePrefix: observed.storagePrefix,
    ...(observed.devicePath ? { devicePath: observed.devicePath } : {}),
  };
}
