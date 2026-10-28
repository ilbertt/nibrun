import type { App, PaidRequest } from '@repo/api-client/models';

const BYTES_PER_GIB = 1_073_741_824;

export type PaidResourceAmounts = Omit<
  Extract<PaidRequest, { requestType: 'resources' }>,
  'requestType' | 'appId'
>;

export function currentPaidResourceAmounts(config: App['config']): PaidResourceAmounts {
  return {
    requestedVcpuCount: config.resources.vcpuCount,
    requestedMemoryMib: config.resources.memoryMib,
    requestedVolumeGib: Math.ceil(config.volumeSizeBytes / BYTES_PER_GIB),
  };
}
