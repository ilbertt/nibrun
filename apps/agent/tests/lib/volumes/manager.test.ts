import { describe, expect, test } from 'bun:test';
import { toReportedVolume } from '#lib/volumes/manager.ts';
import { HOST_STORAGE_PREFIX } from '#tests/support/config.ts';
import { observedVolume, VOLUME_ID, VOLUME_SIZE_BYTES } from '#tests/support/fixtures.ts';

describe('a volume reports itself from having been found', () => {
  // The regression: reports used to accumulate from provisioning, so a volume nobody touched
  // this reconcile went unreported — and after a restart a host serving a volume reported none.
  test('a healthy volume is reportable without anything having provisioned it', () => {
    expect(toReportedVolume(observedVolume())).toEqual({
      volumeId: VOLUME_ID,
      state: 'ready',
      sizeBytes: VOLUME_SIZE_BYTES,
      storagePrefix: HOST_STORAGE_PREFIX,
      devicePath: '/dev/nbd0',
    });
  });

  test('a device file with nothing attached to it is detached rather than ready', () => {
    expect(toReportedVolume(observedVolume({ attached: false })).state).toBe('detached');
  });

  // Where the volume went is what the control plane cannot derive for itself, so it is the one
  // field that must survive being reported by a host that merely found the file.
  test('the storage prefix is carried even when no device is attached', () => {
    const report = toReportedVolume(observedVolume({ attached: false, devicePath: undefined }));
    expect(report.storagePrefix).toBe(HOST_STORAGE_PREFIX);
    expect(report).not.toHaveProperty('devicePath');
  });
});
