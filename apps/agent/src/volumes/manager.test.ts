import { describe, expect, test } from 'bun:test';
import type { ObjectKey, VolumeId } from '@repo/protocol';
import type { ObservedVolume } from '#reconcile/plan.ts';
import { toReportedVolume } from '#volumes/manager.ts';

const VOLUME = 'vol-1' as VolumeId;
const HOST_PREFIX = 'filesystems/host-1' as ObjectKey;
const VOLUME_SIZE_BYTES = 8_589_934_592;

function observed(overrides: Partial<ObservedVolume> = {}): ObservedVolume {
  return {
    volumeId: VOLUME,
    attached: true,
    sizeBytes: VOLUME_SIZE_BYTES,
    storagePrefix: HOST_PREFIX,
    devicePath: '/dev/nbd0',
    ...overrides,
  };
}

describe('a volume reports itself from having been found', () => {
  // The regression: reports used to accumulate from provisioning, so a volume nobody touched
  // this reconcile went unreported — and after a restart a host serving a volume reported none.
  test('a healthy volume is reportable without anything having provisioned it', () => {
    expect(toReportedVolume(observed())).toEqual({
      volumeId: VOLUME,
      state: 'ready',
      sizeBytes: VOLUME_SIZE_BYTES,
      storagePrefix: HOST_PREFIX,
      devicePath: '/dev/nbd0',
    });
  });

  test('a device file with nothing attached to it is detached rather than ready', () => {
    expect(toReportedVolume(observed({ attached: false })).state).toBe('detached');
  });

  // Where the volume went is what the control plane cannot derive for itself, so it is the one
  // field that must survive being reported by a host that merely found the file.
  test('the storage prefix is carried even when no device is attached', () => {
    const report = toReportedVolume(observed({ attached: false, devicePath: undefined }));
    expect(report.storagePrefix).toBe(HOST_PREFIX);
    expect(report).not.toHaveProperty('devicePath');
  });
});
